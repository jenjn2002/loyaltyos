import { evaluateRules } from "@loyaltyos/campaigns";
import { SegmentsService } from "@loyaltyos/segments";
import { prisma } from "../db.js";
import { walletService } from "./wallets.js";
import { LoyaltyError } from "./errors.js";
import { notificationsService } from "./notifications-setup.js";
import { automationSchema } from "./occasion-schedule.js";

const segments = new SegmentsService(prisma);

/**
 * Apply onboarding campaigns immediately after a member is created.
 * The recurring occasions worker remains as a reconciliation path, but new
 * members should not wait for its next minute-based scan before a welcome
 * claim becomes visible.
 */
export async function issueOnboardingForMember(programId: string, memberId: string): Promise<void> {
  const definitions = await prisma.eventDefinition.findMany({
    where: { programId, isActive: true },
  });
  for (const definition of definitions) {
    const parsed = automationSchema.safeParse(definition.automation);
    if (!parsed.success || parsed.data.mode !== "ONBOARDING") continue;
    const now = new Date();
    const campaigns = await prisma.campaign.findMany({
      where: {
        programId,
        eventType: definition.key,
        type: "BONUS_POINTS",
        isActive: true,
        deletedAt: null,
        approvalStatus: { in: ["NOT_REQUIRED", "APPROVED"] },
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      select: { id: true },
    });
    for (const campaign of campaigns) {
      await issueOccasion(campaign.id, memberId, "onboarding", definition.key);
    }
  }
}

/** Same atomic issuance path for scheduled and externally reported occasions. */
export async function issueOccasion(
  campaignId: string,
  memberId: string,
  occurrence: string,
  eventType: string,
  payload: Record<string, unknown> = {},
  options: { ignoreSchedule?: boolean; allowMissingDefinition?: boolean; allowAnyType?: boolean } = {},
) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || (campaign.type !== "BONUS_POINTS" && !options.allowAnyType)) return;
  if (campaign.segmentId && !(await segments.evaluate(memberId, campaign.segmentId)).belongsTo) return;
  const result = await prisma.$transaction(async (tx) => {
    // Serialize with edits, approvals and other runs; the grant and application commit together.
    await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${campaignId} FOR UPDATE`;
    const current = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    if (current.updatedAt.getTime() !== campaign.updatedAt.getTime()) return;
    const now = new Date();
    if (!current.isActive || current.deletedAt || (!options.ignoreSchedule && current.startsAt && current.startsAt > now) || (current.endsAt && current.endsAt < now)) return;
    const definition = eventType
      ? await tx.eventDefinition.findUnique({ where: { programId_key: { programId: current.programId, key: eventType.toLowerCase() } } })
      : null;
    if (!options.allowMissingDefinition && (!definition?.isActive || current.eventType?.toLowerCase() !== definition.key)) return;
    if (options.allowMissingDefinition && current.eventType && definition && current.eventType.toLowerCase() !== definition.key) return;
    if (!["NOT_REQUIRED", "APPROVED"].includes(current.approvalStatus)) return;
    if (current.issuancePolicy === "APPROVAL_REQUIRED" && current.approvalStatus !== "APPROVED") return;
    const key = `occasion:${campaignId}:${memberId}:${occurrence}`;
    const existing = await tx.campaignApplication.findUnique({ where: { campaignId_idempotencyKey: { campaignId, idempotencyKey: key } } });
    if (existing) return { ...existing, alreadyIssued: true };
    if (current.issuanceMode === "CLAIM") {
      const existingClaim = await tx.campaignClaim.findUnique({ where: { campaignId_memberId_occurrence: { campaignId, memberId, occurrence } } });
      if (existingClaim) return { ...existingClaim, alreadyIssued: true };
    }
    if (!evaluateRules(current.conditions as Record<string, unknown> | null, { ...payload, type: eventType, memberId, programId: current.programId })) return;
    if (current.maxUsesPerMember) {
      const [applications, claims] = await Promise.all([
        tx.campaignApplication.count({ where: { campaignId, memberId } }),
        tx.campaignClaim.count({ where: { campaignId, memberId } }),
      ]);
      if (applications + claims >= current.maxUsesPerMember) return;
    }
    const amount = current.multiplier;
    if (!Number.isSafeInteger(amount) || amount <= 0 || !current.pointTypeId) throw new LoyaltyError("CAMPAIGN_GRANT_INVALID", 409);
    const [applicationTotal, claimTotal] = await Promise.all([
      tx.campaignApplication.aggregate({ where: { campaignId }, _sum: { pointsAwarded: true } }),
      tx.campaignClaim.aggregate({ where: { campaignId }, _sum: { pointsAwarded: true } }),
    ]);
    if (current.maxBudget && (applicationTotal._sum.pointsAwarded ?? 0) + (claimTotal._sum.pointsAwarded ?? 0) + amount > current.maxBudget) return;
    if (current.issuanceMode === "CLAIM") {
      const claim = await tx.campaignClaim.create({ data: { campaignId, memberId, occurrence, pointsAwarded: amount } });
      return { ...claim, alreadyIssued: false };
    }
    const result = await walletService.issueWithTransaction(tx, {
      memberId, programId: current.programId, pointTypeId: current.pointTypeId, amount,
      source: `campaign:${campaignId}`, reason: current.justification || `Campaign grant: ${current.name}${definition ? ` (${definition.name})` : ""}`,
      idempotencyKey: key,
      metadata: { eventType, occurrence, campaignId },
    });
    const application = await tx.campaignApplication.create({ data: { campaignId, memberId, idempotencyKey: key, pointsAwarded: amount, metadata: { eventType, occurrence, transactionId: result.transactionId } } });
    return { ...application, alreadyIssued: false };
  }, { timeout: 15000 });

  const claim = result && "status" in result && result.status === "PENDING" && "pointsAwarded" in result && !result.alreadyIssued
    ? result
    : null;
  if (claim) {
    void (async () => {
      try {
        const [campaignDetails, member] = await Promise.all([
          prisma.campaign.findUnique({
            where: { id: campaignId },
            select: {
              programId: true,
              name: true,
              pointType: { select: { id: true, code: true, name: true, unitLabel: true } },
            },
          }),
          prisma.member.findUnique({
            where: { id: memberId },
            select: {
              email: true,
              phone: true,
              locale: true,
              program: { select: { defaultLocale: true } },
            },
          }),
        ]);
        if (!campaignDetails || !member) return;
        await notificationsService.sendTrigger(campaignDetails.programId, "campaign.claim.available", memberId, {
          amount: claim.pointsAwarded,
          campaign: { name: campaignDetails.name },
          pointType: campaignDetails.pointType,
          member,
          _locale: member.locale ?? member.program.defaultLocale ?? "vi-VN",
        });
      } catch (error) {
        console.error("[Notifications] Failed to notify campaign claim", { campaignId, memberId, error });
      }
    })();
  }
  return result;
}
