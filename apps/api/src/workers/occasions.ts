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
    let cursor: string | undefined;
    do {
      const members = await prisma.member.findMany({
        where: { programId: definition.programId, status: "ACTIVE", deletedAt: null },
        select: { id: true, joinedAt: true, metadata: true }, orderBy: { id: "asc" }, take: 200,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const member of members) for (const campaign of campaigns) {
        const key = parsed.data.mode === "MANUAL"
          ? `manual:${campaign.updatedAt.toISOString()}`
          : occasionKey(parsed.data, member, now, campaign.startsAt && campaign.startsAt > campaign.createdAt ? campaign.startsAt : campaign.createdAt);
        if (!key) continue;
        try { await issueOccasion(campaign.id, member.id, key, definition.key); }
        catch (error) { failures++; console.error("Occasion issuance failed", { campaignId: campaign.id, memberId: member.id, occurrence: key, error }); }
      }
      cursor = members.length === 200 ? members[members.length - 1]!.id : undefined;
    } while (cursor);
  }
  if (failures) throw new Error(`${failures} occasion grants failed; see worker logs. Successful grants will not be repeated.`);
}
export async function startOccasionsWorker(): Promise<void> {
  createWorker("campaigns.occasions", async () => runOccasions());
  await createQueue("campaigns.occasions").upsertJobScheduler("occasion-scan", { every: 60000 }, { name: "scan", data: {} });
}
