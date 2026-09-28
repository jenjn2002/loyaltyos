import { prisma } from "../db.js";
import { automationSchema, occasionKey } from "../lib/occasion-schedule.js";
import { issueOccasion } from "../lib/occasion-issuance.js";
import { createQueue, createWorker } from "../lib/queue.js";

export async function runOccasions(now = new Date()): Promise<void> {
  const definitions = await prisma.eventDefinition.findMany({ where: { isActive: true } });
  let failures = 0;
  for (const definition of definitions) {
    const parsed = automationSchema.safeParse(definition.automation);
    if (!parsed.success || parsed.data.mode === "EXTERNAL") continue;
    const campaigns = await prisma.campaign.findMany({ where: {
      programId: definition.programId, eventType: definition.key, type: "BONUS_POINTS", isActive: true, deletedAt: null,
      approvalStatus: { in: ["NOT_REQUIRED", "APPROVED"] },
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
    } });
    if (!campaigns.length) continue;
    for (const campaign of campaigns) {
      let manualRunClaimed = false;
      if (parsed.data.mode === "MANUAL") {
        let execution = await prisma.campaignManualExecution.findUnique({ where: { campaignId: campaign.id } });
        if (!execution) {
          try {
            execution = await prisma.campaignManualExecution.create({ data: { campaignId: campaign.id } });
            manualRunClaimed = true;
          } catch (error) {
            if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
            execution = await prisma.campaignManualExecution.findUnique({ where: { campaignId: campaign.id } });
          }
        }
        if (!manualRunClaimed && execution && execution.status !== "COMPLETED") {
          const staleLease = execution.status === "RUNNING" && execution.startedAt.getTime() < now.getTime() - 10 * 60_000;
          if (execution.status === "FAILED" || staleLease) {
            const claim = await prisma.campaignManualExecution.updateMany({
              where: { id: execution.id, status: execution.status, startedAt: execution.startedAt },
              data: { status: "RUNNING", startedAt: now, completedAt: null, error: null },
            });
            manualRunClaimed = claim.count === 1;
          }
        }
        if (!manualRunClaimed) continue;
      }

      let campaignFailures = 0;
      let cursor: string | undefined;
      do {
        const members = await prisma.member.findMany({
          where: { programId: definition.programId, status: "ACTIVE", deletedAt: null },
          select: { id: true, joinedAt: true, metadata: true }, orderBy: { id: "asc" }, take: 200,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        for (const member of members) {
          const occurrence = parsed.data.mode === "MANUAL"
            ? `manual:${campaign.id}`
            : occasionKey(parsed.data, member, now, campaign.startsAt && campaign.startsAt > campaign.createdAt ? campaign.startsAt : campaign.createdAt);
          if (!occurrence) continue;
          try {
            await issueOccasion(
              campaign.id,
              member.id,
              occurrence,
              definition.key,
              {},
              parsed.data.mode === "MANUAL" ? { ignoreSchedule: true, allowMissingDefinition: true } : {},
            );
          } catch (error) {
            failures++;
            campaignFailures++;
            console.error("Occasion issuance failed", { campaignId: campaign.id, memberId: member.id, occurrence, error });
          }
        }
        cursor = members.length === 200 ? members[members.length - 1]!.id : undefined;
      } while (cursor);

      if (manualRunClaimed) {
        const stillRunnable = await prisma.campaign.findFirst({
          where: { id: campaign.id, isActive: true, deletedAt: null, approvalStatus: { in: ["NOT_REQUIRED", "APPROVED"] } },
          select: { id: true },
        });
        await prisma.campaignManualExecution.update({
          where: { campaignId: campaign.id },
          data: campaignFailures > 0 || !stillRunnable
            ? { status: "FAILED", completedAt: null, error: campaignFailures > 0 ? `${campaignFailures} member issuance attempts failed.` : "Campaign was paused during execution." }
            : { status: "COMPLETED", completedAt: new Date(), error: null },
        });
      }
    }
  }
  if (failures) throw new Error(`${failures} occasion grants failed; see worker logs. Successful grants will not be repeated.`);
}
export async function startOccasionsWorker(): Promise<void> {
  createWorker("campaigns.occasions", async () => runOccasions());
  await createQueue("campaigns.occasions").upsertJobScheduler("occasion-scan", { every: 60000 }, { name: "scan", data: {} });
}
