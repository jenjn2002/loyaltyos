import { evaluateRules } from "@loyaltyos/campaigns";
import { BadgesService, TiersService } from "@loyaltyos/badges";
import { SegmentsService } from "@loyaltyos/segments";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { LoyaltyError } from "../lib/errors.js";
import { issueOccasion } from "../lib/occasion-issuance.js";
import { notificationsService } from "../lib/notifications-setup.js";
import { automationSchema, localDate } from "../lib/occasion-schedule.js";

const segments = new SegmentsService(prisma);
const badges = new BadgesService(prisma);
const tiers = new TiersService(prisma);
const historyDays = 365;

async function memberCheckInDefinition(programId: string, key: string) {
  const definition = await prisma.eventDefinition.findUnique({
    where: { programId_key: { programId, key } },
  });
  if (!definition) return null;
  const automation = automationSchema.safeParse(definition.automation);
  if (!automation.success || automation.data.mode !== "MEMBER_CHECK_IN") return null;
  return { ...definition, automation: automation.data };
}

async function eligibleCampaigns(input: {
  programId: string;
  memberId: string;
  eventKey: string;
  checkInDate: string;
  now: Date;
}) {
  const campaigns = await prisma.campaign.findMany({
    where: {
      programId: input.programId,
      eventType: input.eventKey,
      type: "BONUS_POINTS",
      isActive: true,
      approvalStatus: { in: ["NOT_REQUIRED", "APPROVED"] },
      deletedAt: null,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: input.now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: input.now } }] },
      ],
    },
    include: {
      pointType: { select: { id: true, code: true, name: true, unitLabel: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const eligible = [];
  for (const campaign of campaigns) {
    if (!campaign.pointTypeId || !Number.isSafeInteger(campaign.multiplier) || campaign.multiplier <= 0) continue;
    if (campaign.segmentId && !(await segments.evaluate(input.memberId, campaign.segmentId)).belongsTo) continue;
    if (!evaluateRules(campaign.conditions as Record<string, unknown> | null, {
      type: input.eventKey,
      memberId: input.memberId,
      programId: input.programId,
      checkInDate: input.checkInDate,
      date: input.checkInDate,
    })) continue;
    if (campaign.maxUsesPerMember) {
      const [applications, claims] = await Promise.all([
        prisma.campaignApplication.count({ where: { campaignId: campaign.id, memberId: input.memberId } }),
        prisma.campaignClaim.count({ where: { campaignId: campaign.id, memberId: input.memberId } }),
      ]);
      if (applications + claims >= campaign.maxUsesPerMember) continue;
    }
    if (campaign.maxBudget) {
      const [applications, claims] = await Promise.all([
        prisma.campaignApplication.aggregate({ where: { campaignId: campaign.id }, _sum: { pointsAwarded: true } }),
        prisma.campaignClaim.aggregate({ where: { campaignId: campaign.id }, _sum: { pointsAwarded: true } }),
      ]);
      const issued = (applications._sum.pointsAwarded ?? 0) + (claims._sum.pointsAwarded ?? 0);
      if (issued + campaign.multiplier > campaign.maxBudget) continue;
    }
    eligible.push(campaign);
  }
  return eligible;
}

export function checkInRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get("/members/me/check-ins", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const definitions = await prisma.eventDefinition.findMany({
      where: { programId: request.programId },
      orderBy: { createdAt: "asc" },
    });
    const checkInDefinitions = definitions.flatMap((definition) => {
      const automation = automationSchema.safeParse(definition.automation);
      return automation.success && automation.data.mode === "MEMBER_CHECK_IN"
        ? [{ ...definition, automation: automation.data }]
        : [];
    });
    if (checkInDefinitions.length === 0) return reply.send({ data: { events: [] } });

    const now = new Date();
    const historyStart = new Date(now.getTime() - (historyDays + 2) * 86_400_000);
    const keys = checkInDefinitions.map((definition) => definition.key);
    const [events, member] = await Promise.all([
      prisma.event.findMany({
        where: {
          programId: request.programId,
          memberId: request.memberId,
          type: { in: keys },
          processed: true,
          createdAt: { gte: historyStart },
        },
        select: { type: true, createdAt: true, payload: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.member.findFirst({
        where: { id: request.memberId, programId: request.programId, deletedAt: null, status: "ACTIVE" },
        select: { id: true },
      }),
    ]);
    if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);

    const data = await Promise.all(checkInDefinitions.map(async (definition) => {
      const today = localDate(now, definition.automation.timezone);
      const history = events
        .filter((event) => event.type === definition.key)
        .map((event) => {
          const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
            ? event.payload as Record<string, unknown>
            : {};
          return typeof payload.checkInDate === "string"
            ? payload.checkInDate
            : localDate(event.createdAt, definition.automation.timezone);
        })
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
      // Hide the check-in card and its calendar when there is no active,
      // approved campaign attached to this event. Keep the stored history so
      // it reappears if the campaign is activated again.
      const hasActiveCampaign = definition.isActive && await prisma.campaign.findFirst({
        where: {
          programId: request.programId,
          eventType: definition.key,
          type: "BONUS_POINTS",
          isActive: true,
          approvalStatus: { in: ["NOT_REQUIRED", "APPROVED"] },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!hasActiveCampaign) return null;

      const campaignList = definition.isActive
        ? await eligibleCampaigns({
            programId: request.programId,
            memberId: request.memberId!,
            eventKey: definition.key,
            checkInDate: today,
            now,
          })
        : [];
      return {
        key: definition.key,
        name: definition.name,
        timezone: definition.automation.timezone,
        today,
        checkedInDates: [...new Set(history)],
        checkedInToday: history.includes(today),
        canCheckIn: campaignList.length > 0 && !history.includes(today),
        campaigns: campaignList.map((campaign) => ({
          id: campaign.id,
          name: campaign.name,
          points: campaign.multiplier,
          issuanceMode: campaign.issuanceMode,
          pointType: campaign.pointType,
        })),
      };
    }));
    return reply.send({ data: { events: data.filter((event) => event !== null) } });
  });

  app.post("/members/me/check-ins/:eventKey", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const { eventKey } = z.object({ eventKey: z.string().trim().min(1).max(80) }).parse(request.params);
    const definition = await memberCheckInDefinition(request.programId, eventKey);
    if (!definition?.isActive) throw new LoyaltyError("CHECK_IN_EVENT_NOT_AVAILABLE", 409);
    const member = await prisma.member.findFirst({
      where: { id: request.memberId, programId: request.programId, deletedAt: null, status: "ACTIVE" },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        locale: true,
        program: { select: { defaultLocale: true } },
      },
    });
    if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);

    const now = new Date();
    const checkInDate = localDate(now, definition.automation.timezone);
    const idempotencyKey = `member-check-in:${eventKey}:${member.id}:${checkInDate}`;
    const existing = await prisma.event.findUnique({
      where: { programId_idempotencyKey: { programId: request.programId, idempotencyKey } },
    });
    if (existing?.processed) {
      return reply.send({ data: { eventKey, checkInDate, alreadyCheckedIn: true, rewards: [] } });
    }

    const campaigns = await eligibleCampaigns({
      programId: request.programId,
      memberId: member.id,
      eventKey,
      checkInDate,
      now,
    });
    if (campaigns.length === 0) throw new LoyaltyError("CHECK_IN_CAMPAIGN_NOT_AVAILABLE", 409);

    const event = await prisma.event.upsert({
      where: { programId_idempotencyKey: { programId: request.programId, idempotencyKey } },
      create: {
        programId: request.programId,
        memberId: member.id,
        type: eventKey,
        payload: { checkInDate, timezone: definition.automation.timezone },
        idempotencyKey,
      },
      update: {},
    });
    const rewards: Array<{ campaignId: string; campaignName: string; points: number; pointType: string; claimPending: boolean }> = [];
    for (const campaign of campaigns) {
      const result = await issueOccasion(
        campaign.id,
        member.id,
        checkInDate,
        eventKey,
        { checkInDate, date: checkInDate },
      ) as { pointsAwarded?: number; status?: string } | undefined;
      if (!result) continue;
      rewards.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        points: result.pointsAwarded ?? campaign.multiplier,
        pointType: campaign.pointType?.name ?? campaign.pointType?.code ?? "points",
        claimPending: result.status === "PENDING",
      });
    }
    if (rewards.length === 0) {
      await prisma.event.update({
        where: { id: event.id },
        data: { error: "No eligible check-in campaign issued a reward." },
      });
      throw new LoyaltyError("CHECK_IN_REWARD_UNAVAILABLE", 409);
    }
    const pointsAwarded = rewards.reduce((sum, reward) => sum + (reward.claimPending ? 0 : reward.points), 0);
    // Keep this Event unprocessed while badges query historical events; the
    // evaluator adds the current event itself, so marking it first double-counts.
    const [badgeResult, tierResult] = await Promise.all([
      badges.evaluateOnEvent({
        type: eventKey,
        memberId: member.id,
        programId: request.programId,
        amount: pointsAwarded,
        payload: { checkInDate, timezone: definition.automation.timezone },
      }).catch((error: unknown) => {
        request.log.warn({ error, eventId: event.id }, "Check-in badge evaluation failed");
        return null;
      }),
      tiers.evaluateMember(member.id, request.programId).catch((error: unknown) => {
        request.log.warn({ error, memberId: member.id }, "Check-in tier evaluation failed");
        return null;
      }),
    ]);
    const notificationMember = {
      id: member.id,
      email: member.email,
      phone: member.phone,
      firstName: member.firstName,
      lastName: member.lastName,
      currentTier: tierResult?.currentTier?.name,
    };
    const locale = member.locale ?? member.program.defaultLocale ?? "vi-VN";
    if (tierResult?.changed && tierResult.direction === "upgrade") {
      await notificationsService.sendTrigger(request.programId, "tier.changed", member.id, {
        member: notificationMember,
        previousTier: tierResult.previousTier?.name,
        currentTier: tierResult.currentTier?.name,
        direction: "upgrade",
        _locale: locale,
      }).catch((error: unknown) => request.log.warn({ error, eventId: event.id }, "Check-in tier notification failed"));
    }
    for (const badge of badgeResult?.unlocked ?? []) {
      await notificationsService.sendTrigger(request.programId, "badge.unlocked", member.id, {
        member: notificationMember,
        badgeId: badge.id,
        badgeName: badge.name,
        badgeType: badge.type,
        _locale: locale,
      }).catch((error: unknown) => request.log.warn({ error, eventId: event.id }, "Check-in badge notification failed"));
    }
    await notificationsService.sendTrigger(request.programId, "check_in", member.id, {
      member: notificationMember,
      eventKey,
      checkInDate,
      points: pointsAwarded,
      rewards,
      _locale: locale,
    }).catch((error: unknown) => request.log.warn({ error, eventId: event.id }, "Check-in notification failed"));
    await prisma.event.update({
      where: { id: event.id },
      data: { processed: true, processedAt: new Date(), error: null },
    });
    await audit(request.programId, request.actor, "OTHER", "member_check_in", event.id, {
      operation: "CHECK_IN",
      memberId: member.id,
      eventKey,
      checkInDate,
      rewards,
      unlockedBadges: badgeResult?.unlocked.map((badge) => badge.id) ?? [],
      tierChanged: Boolean(tierResult?.changed && tierResult.direction === "upgrade"),
    });
    return reply.status(201).send({ data: { eventKey, checkInDate, alreadyCheckedIn: false, rewards } });
  });

  done();
}
