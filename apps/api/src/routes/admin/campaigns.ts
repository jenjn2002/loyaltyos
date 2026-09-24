import { CampaignsService } from "@loyaltyos/campaigns";
import { SegmentsService } from "@loyaltyos/segments";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { LoyaltyError } from "../../lib/errors.js";
import { walletService } from "../../lib/wallets.js";
import { createApprovalRequestWithClient } from "../../lib/approval-workflows.js";
import { isStandingOccasionMode } from "../../lib/occasion-schedule.js";
import { issueOccasion } from "../../lib/occasion-issuance.js";

const points = {
  earn: (input: Parameters<typeof walletService.earn>[0]) => walletService.earn(input),
};
const campaigns = new CampaignsService(prisma, points);
const segments = new SegmentsService(prisma);

const createSchema = z.object({
  pointTypeId: z.string().min(1),
  segmentId: z.string().min(1).nullable().optional(),
  eventType: z.string().trim().min(1).max(80).nullable().optional(),
  issuancePolicy: z.enum(["STANDING", "APPROVAL_REQUIRED"]).optional(),
  issuanceMode: z.enum(["AUTO", "CLAIM"]).optional(),
  saveAsDraft: z.boolean().optional(),
  justification: z.string().trim().max(2000).nullable().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum([
    "BONUS_POINTS",
    "SPEND_AND_GET",
    "FREQUENCY",
    "MILESTONE",
    "REFERRAL",
    "BIRTHDAY",
    "ANNIVERSARY",
    "FLASH_SALE",
    "TIER_UPGRADE_BONUS",
  ]),
  conditions: z.record(z.unknown()).optional(),
  multiplier: z.number().min(0).optional(),
  maxBudget: z.number().int().nullable().optional(),
  maxUsesPerMember: z.number().int().optional(),
  isStackable: z.boolean().optional(),
  abTesting: z.boolean().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  variants: z
    .array(
      z.object({
        name: z.string().min(1),
        trafficPct: z.number().min(0).max(100),
        config: z.record(z.unknown()).optional(),
      }),
    )
    .optional(),
});

const updateSchema = createSchema.omit({ type: true }).partial();

const lifecycleSchema = z.object({
  action: z.enum(["activate", "pause", "archive"]),
});

async function assertPointType(programId: string, pointTypeId: string): Promise<void> {
  const pointType = await prisma.pointTypeDefinition.findFirst({
    where: { id: pointTypeId, programId, isActive: true, archivedAt: null },
    select: { id: true },
  });
  if (!pointType) throw new LoyaltyError("POINT_TYPE_NOT_FOUND", 404);
}

async function assertSegment(programId: string, segmentId: string): Promise<void> {
  const segment = await prisma.segment.findFirst({
    where: { id: segmentId, programId, isActive: true },
    select: { id: true },
  });
  if (!segment) throw new LoyaltyError("SEGMENT_NOT_FOUND", 404);
}

type IssuancePolicy = "STANDING" | "APPROVAL_REQUIRED";

function automationMode(definition: { automation: unknown } | null): string | undefined {
  const automation = definition?.automation;
  return automation && typeof automation === "object" && "mode" in automation && typeof automation.mode === "string"
    ? automation.mode
    : undefined;
}

function defaultIssuancePolicy(definition: { key: string; automation: unknown } | null): IssuancePolicy {
  if (!definition || definition.key.toLowerCase() === "purchase") return "STANDING";
  return isStandingOccasionMode(automationMode(definition)) ? "STANDING" : "APPROVAL_REQUIRED";
}

function resolveIssuancePolicy(
  definition: { key: string; automation: unknown } | null,
  requested: IssuancePolicy | undefined,
  legacyRequiresApproval?: boolean,
): IssuancePolicy {
  const policy = requested ?? (definition ? defaultIssuancePolicy(definition) : legacyRequiresApproval ? "APPROVAL_REQUIRED" : "STANDING");
  if (policy === "STANDING" && definition && definition.key.toLowerCase() !== "purchase" && !isStandingOccasionMode(automationMode(definition))) {
    throw new LoyaltyError("CAMPAIGN_POLICY_REQUIRES_APPROVAL", 400);
  }
  return policy;
}

async function ownedCampaign(id: string, programId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id, programId, deletedAt: null },
  });
  if (!campaign) throw new LoyaltyError("CAMPAIGN_NOT_FOUND", 404);
  return campaign;
}

export function adminCampaignsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  // POST /admin/campaigns — Create campaign
  app.post("/admin/campaigns", async (request, reply) => {
    const body = createSchema.parse(request.body);
    const { saveAsDraft, ...campaignBody } = body;
    const programId = request.programId;
    const definition = body.eventType ? await prisma.eventDefinition.findUnique({ where: { programId_key: { programId, key: body.eventType.toLowerCase() } } }) : null;
    if (body.eventType && !definition?.isActive) throw new LoyaltyError("ACTIVE_EVENT_DEFINITION_REQUIRED", 400);
    const issuancePolicy = resolveIssuancePolicy(definition, body.issuancePolicy, definition?.requiresApproval);
    if (!saveAsDraft && issuancePolicy === "APPROVAL_REQUIRED" && !body.justification?.trim()) throw new LoyaltyError("JUSTIFICATION_REQUIRED", 400);
    if (definition && definition.key !== "purchase" && body.type !== "BONUS_POINTS") throw new LoyaltyError("OCCASION_REQUIRES_BONUS_POINTS_CAMPAIGN", 400);
    if (definition && definition.key !== "purchase" && (!Number.isSafeInteger(body.multiplier) || !body.multiplier || body.multiplier <= 0)) throw new LoyaltyError("CAMPAIGN_GRANT_INVALID", 400);
    await assertPointType(programId, body.pointTypeId);
    if (body.segmentId) await assertSegment(programId, body.segmentId);
    if (body.startsAt && body.endsAt && body.endsAt <= body.startsAt)
      throw new LoyaltyError("CAMPAIGN_DATES_INVALID", 400);
    const campaign = await campaigns.create({
      ...campaignBody,
      programId,
      createdById: request.adminId,
      eventType: definition?.key ?? null,
      issuancePolicy,
      approvalStatus: saveAsDraft || issuancePolicy === "APPROVAL_REQUIRED" ? "DRAFT" : "NOT_REQUIRED",
      isActive: !saveAsDraft && issuancePolicy !== "APPROVAL_REQUIRED",
    });
    await audit(programId, request.actor, "CONFIG_CHANGE", "campaign", campaign.id, {
      created: true,
      pointTypeId: body.pointTypeId,
    });
    return reply.status(201).send({ data: campaign });
  });

  // GET /admin/campaigns — List campaigns
  app.get("/admin/campaigns", async (request, reply) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
        isActive: z
          .enum(["true", "false"])
          .optional()
          .transform((v) => {
            if (v === "true") return true;
            if (v === "false") return false;
            return undefined;
          }),
      })
      .parse(request.query);

    const where: Prisma.CampaignWhereInput = {
      programId: request.programId,
      deletedAt: null,
    };

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const [items, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        include: {
          variants: true,
          createdBy: { select: { id: true, name: true, email: true } },
        },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
      }),
      prisma.campaign.count({ where }),
    ]);

    const activeMembers = items.length
      ? await prisma.member.findMany({
          where: { programId: request.programId, deletedAt: null },
          select: { id: true },
        })
      : [];
    const activeMemberIds = activeMembers.map((member) => member.id);
    const memberFilter = { memberId: { in: activeMemberIds } };
    const applicationTotals = items.length && activeMemberIds.length
      ? await prisma.campaignApplication.groupBy({
          by: ["campaignId"],
          where: { campaignId: { in: items.map((campaign) => campaign.id) }, ...memberFilter },
          _count: { _all: true },
          _sum: { pointsAwarded: true },
        })
      : [];
    const claimTotals = items.length && activeMemberIds.length
      ? await prisma.campaignClaim.groupBy({
          by: ["campaignId", "status"],
          where: { campaignId: { in: items.map((campaign) => campaign.id) }, ...memberFilter },
          _count: { _all: true },
          _sum: { pointsAwarded: true },
        })
      : [];
    const totalsByCampaign = new Map<string, { count: number; points: number; pendingClaims: number }>(
      applicationTotals.map((summary) => [summary.campaignId, {
        count: summary._count._all,
        points: summary._sum.pointsAwarded ?? 0,
        pendingClaims: 0,
      }] as [string, { count: number; points: number; pendingClaims: number }]),
    );
    for (const summary of claimTotals) {
      const current = totalsByCampaign.get(summary.campaignId) ?? { count: 0, points: 0, pendingClaims: 0 };
      if (summary.status === "CLAIMED") {
        current.count += summary._count._all;
        current.points += summary._sum.pointsAwarded ?? 0;
      }
      if (summary.status === "PENDING") current.pendingClaims += summary._count._all;
      totalsByCampaign.set(summary.campaignId, current);
    }

    return reply.send({
      data: {
        items: items.map((campaign) => ({
          ...campaign,
        issuance: totalsByCampaign.get(campaign.id) ?? { count: 0, points: 0, pendingClaims: 0 },
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  });

  // GET /admin/campaigns/:id — Get campaign by id
  app.get("/admin/campaigns/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const campaign = await prisma.campaign.findFirst({
      where: { id, programId: request.programId },
      include: {
        variants: true,
        applications: true,
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!campaign) {
      return reply
        .status(404)
        .send({ error: { code: "NOT_FOUND", message: "Campaign not found" } });
    }
    return reply.send({ data: campaign });
  });

  // GET /admin/campaigns/:id/issuance — Inspect campaign grants and recipients
  app.get("/admin/campaigns/:id/issuance", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
      })
      .parse(request.query);
    const campaign = await prisma.campaign.findFirst({
      where: { id, programId: request.programId, deletedAt: null },
      select: {
        id: true,
        name: true,
        eventType: true,
        issuancePolicy: true,
        issuanceMode: true,
        approvalStatus: true,
        isActive: true,
        startsAt: true,
        endsAt: true,
        maxBudget: true,
        segmentId: true,
      },
    });
    if (!campaign) throw new LoyaltyError("CAMPAIGN_NOT_FOUND", 404);

    const activeMembers = await prisma.member.findMany({
      where: { programId: request.programId, deletedAt: null },
      select: { id: true, email: true, externalId: true, firstName: true, lastName: true, department: true },
    });
    const activeMemberIds = activeMembers.map((member) => member.id);
    const memberFilter = { memberId: { in: activeMemberIds } };
    const [applications, applicationTotal, claims, claimTotal] = await Promise.all([
      prisma.campaignApplication.findMany({
        where: { campaignId: id, ...memberFilter },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          memberId: true,
          eventId: true,
          pointsAwarded: true,
          metadata: true,
          createdAt: true,
        },
      }),
      prisma.campaignApplication.aggregate({
        where: { campaignId: id, ...memberFilter },
        _sum: { pointsAwarded: true },
      }),
      prisma.campaignClaim.findMany({
        where: { campaignId: id, ...memberFilter },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          memberId: true,
          occurrence: true,
          pointsAwarded: true,
          status: true,
          claimedAt: true,
          createdAt: true,
        },
      }),
      prisma.campaignClaim.aggregate({
        where: { campaignId: id, status: "CLAIMED", ...memberFilter },
        _sum: { pointsAwarded: true },
      }),
    ]);
    const [totalApplications, totalClaims, claimedClaimCount, pendingClaimCount] = await Promise.all([
      prisma.campaignApplication.count({ where: { campaignId: id, ...memberFilter } }),
      prisma.campaignClaim.count({ where: { campaignId: id, ...memberFilter } }),
      prisma.campaignClaim.count({ where: { campaignId: id, status: "CLAIMED", ...memberFilter } }),
      prisma.campaignClaim.count({ where: { campaignId: id, status: "PENDING", ...memberFilter } }),
    ]);
    const membersById = new Map(activeMembers.map((member) => [member.id, member]));
    const now = new Date();
    const total = totalApplications + totalClaims;
    const claimedClaims = claimedClaimCount;
    const pendingClaims = pendingClaimCount;
    const issuedCount = totalApplications + claimedClaims;
    const totalPoints = (applicationTotal._sum.pointsAwarded ?? 0) + (claimTotal._sum.pointsAwarded ?? 0);
    const status = !["NOT_REQUIRED", "APPROVED"].includes(campaign.approvalStatus)
      ? "WAITING_APPROVAL"
      : !campaign.isActive
        ? "PAUSED"
        : campaign.startsAt && campaign.startsAt > now
          ? "SCHEDULED"
          : campaign.endsAt && campaign.endsAt < now
              ? (issuedCount > 0 ? "ENDED" : "ENDED_WITHOUT_ISSUANCE")
            : issuedCount > 0
              ? "ISSUED"
              : pendingClaims > 0
                ? "CLAIM_PENDING"
                : "NOT_ISSUED";

    return reply.send({
      data: {
        campaign,
        status,
        issuedCount,
        totalPoints,
        pendingClaims,
        items: [
          ...applications.map((application) => ({
          ...application,
          member: membersById.get(application.memberId) ?? null,
            recordType: "ISSUED" as const,
          })),
          ...claims.map((claim) => ({
            ...claim,
            eventId: null,
            metadata: { eventType: campaign.eventType, occurrence: claim.occurrence },
            member: membersById.get(claim.memberId) ?? null,
            recordType: claim.status === "CLAIMED" ? "ISSUED" as const : "CLAIM" as const,
          })),
        ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  });

  // PATCH /admin/campaigns/:id — Update campaign
  app.patch("/admin/campaigns/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateSchema.parse(request.body);
    const saveAsDraft = body.saveAsDraft === true;
    const existing = await ownedCampaign(id, request.programId);
    if (existing.approvalStatus === "PENDING") throw new LoyaltyError("CAMPAIGN_APPROVAL_PENDING", 409);
    const key = body.eventType === undefined ? existing.eventType : body.eventType;
    const definition = key ? await prisma.eventDefinition.findUnique({ where: { programId_key: { programId: request.programId, key: key.toLowerCase() } } }) : null;
    if (key && !definition?.isActive) throw new LoyaltyError("ACTIVE_EVENT_DEFINITION_REQUIRED", 400);
    const issuancePolicy = resolveIssuancePolicy(definition, body.issuancePolicy ?? existing.issuancePolicy as IssuancePolicy, definition?.requiresApproval);
    const requiresReapproval = existing.approvalStatus === "APPROVED";
    if (!saveAsDraft && (issuancePolicy === "APPROVAL_REQUIRED" || requiresReapproval) && !(body.justification ?? existing.justification)?.trim()) throw new LoyaltyError("JUSTIFICATION_REQUIRED", 400);
    if (definition && definition.key !== "purchase" && existing.type !== "BONUS_POINTS") throw new LoyaltyError("OCCASION_REQUIRES_BONUS_POINTS_CAMPAIGN", 400);
    const amount = body.multiplier ?? existing.multiplier;
    if (definition && definition.key !== "purchase" && (!Number.isSafeInteger(amount) || amount <= 0)) throw new LoyaltyError("CAMPAIGN_GRANT_INVALID", 400);
    if (body.pointTypeId) await assertPointType(request.programId, body.pointTypeId);
    if (body.segmentId) await assertSegment(request.programId, body.segmentId);
    const startsAt = body.startsAt === undefined ? existing.startsAt : body.startsAt;
    const endsAt = body.endsAt === undefined ? existing.endsAt : body.endsAt;
    if (startsAt && endsAt && endsAt <= startsAt)
      throw new LoyaltyError("CAMPAIGN_DATES_INVALID", 400);
    const { variants, saveAsDraft: _saveAsDraft, pointTypeId, segmentId, ...campaignBody } = body;
    const campaign = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.campaign.findUniqueOrThrow({ where: { id } });
      if (current.approvalStatus === "PENDING" || current.updatedAt.getTime() !== existing.updatedAt.getTime()) throw new LoyaltyError("CAMPAIGN_CHANGED_RELOAD", 409);
      await tx.campaign.update({ where: { id }, data: {
        ...campaignBody,
        maxBudget: campaignBody.maxBudget === 0 ? null : campaignBody.maxBudget,
        conditions: campaignBody.conditions as Prisma.InputJsonValue | undefined,
        pointType: pointTypeId === undefined ? undefined : { connect: { id: pointTypeId } },
        segment: segmentId === undefined
          ? undefined
          : segmentId === null
            ? { disconnect: true }
            : { connect: { id: segmentId } },
        eventType: definition?.key ?? null,
        issuancePolicy,
        approvalStatus: saveAsDraft || requiresReapproval || issuancePolicy === "APPROVAL_REQUIRED" ? "DRAFT" : "NOT_REQUIRED",
        isActive: !saveAsDraft && !requiresReapproval && issuancePolicy !== "APPROVAL_REQUIRED",
      } });
      if (variants !== undefined) {
        await tx.campaignVariant.deleteMany({ where: { campaignId: id } });
        if (variants.length > 0) {
          await tx.campaignVariant.createMany({
            data: variants.map((variant) => ({
              campaignId: id,
              name: variant.name,
              trafficPct: variant.trafficPct,
              config: variant.config as Prisma.InputJsonValue | undefined,
            })),
          });
        }
      }
      return tx.campaign.findUniqueOrThrow({ where: { id }, include: { variants: true } });
    });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "campaign", id, body);
    return reply.send({ data: campaign });
  });

  // DELETE /admin/campaigns/:id — Soft delete campaign
  app.delete("/admin/campaigns/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await ownedCampaign(id, request.programId);
    await campaigns.archive(id);
    return reply.status(204).send();
  });

  // POST /admin/campaigns/estimate — Estimate impact before creation
  app.post("/admin/campaigns/estimate", async (request, reply) => {
    const body = z
      .object({
        type: z.string().optional(),
        multiplier: z.number().finite().optional(),
        maxBudget: z.number().finite().optional(),
        maxUsesPerMember: z.number().int().min(0).optional(),
        segmentId: z.string().min(1).nullable().optional(),
        eventType: z.string().trim().max(80).nullable().optional(),
      })
      .parse(request.body);

    let estimatedMembers: number | undefined;
    if (body.segmentId) {
      await assertSegment(request.programId, body.segmentId);
      const members = await prisma.member.findMany({
        where: { programId: request.programId, status: "ACTIVE", deletedAt: null },
        select: { id: true },
      });
      const evaluations = await Promise.all(
        members.map(async (member) => (await segments.evaluate(member.id, body.segmentId as string)).belongsTo),
      );
      estimatedMembers = evaluations.filter(Boolean).length;
    } else {
      estimatedMembers = await prisma.member.count({
        where: { programId: request.programId, status: "ACTIVE", deletedAt: null },
      });
    }

    const result = await campaigns.estimateImpact({
      programId: request.programId,
      multiplier: body.multiplier,
      maxBudget: body.maxBudget,
      maxUsesPerMember: body.maxUsesPerMember,
      estimatedMembers,
      isPurchase: !body.eventType || body.eventType.toLowerCase() === "purchase",
    });
    return reply.send({ data: result });
  });

  // POST /admin/campaigns/:id/estimate — Estimate campaign impact
  app.post("/admin/campaigns/:id/estimate", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const campaign = await prisma.campaign.findFirst({
      where: { id, programId: request.programId },
    });
    if (!campaign) {
      return reply
        .status(404)
        .send({ error: { code: "NOT_FOUND", message: "Campaign not found" } });
    }

    const result = await campaigns.estimateImpact({
      programId: campaign.programId,
      type: campaign.type,
      multiplier: campaign.multiplier,
      maxBudget: campaign.maxBudget ?? undefined,
    });
    return reply.send({ data: result });
  });

  // POST /admin/campaigns/:id/lifecycle — Manage campaign lifecycle
  app.post("/admin/campaigns/:id/lifecycle", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { action } = lifecycleSchema.parse(request.body);
    await ownedCampaign(id, request.programId);

    switch (action) {
      case "activate":
        await campaigns.activate(id);
        break;
      case "pause":
        await campaigns.pause(id);
        break;
      case "archive":
        await campaigns.archive(id);
        break;
    }

    return reply.send({ data: { id, action } });
  });

  app.post("/admin/campaigns/:id/run-now", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const campaign = await ownedCampaign(id, request.programId);
    if (!campaign.pointTypeId) throw new LoyaltyError("CAMPAIGN_POINT_TYPE_REQUIRED", 409);
    if (!campaign.isActive || !["NOT_REQUIRED", "APPROVED"].includes(campaign.approvalStatus)) {
      throw new LoyaltyError("CAMPAIGN_NOT_READY", 409);
    }
    if (campaign.endsAt && campaign.endsAt < new Date()) throw new LoyaltyError("CAMPAIGN_ENDED", 409);

    const occurrence = `manual:${campaign.updatedAt.toISOString()}`;
    const eventType = campaign.eventType ?? "manual";
    let processed = 0;
    let issued = 0;
    let cursor: string | undefined;
    do {
      const members = await prisma.member.findMany({
        where: { programId: request.programId, status: "ACTIVE", deletedAt: null },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 200,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const member of members) {
        const result = await issueOccasion(
          campaign.id,
          member.id,
          occurrence,
          eventType,
          { runNow: true },
          { ignoreSchedule: true, allowMissingDefinition: true, allowAnyType: true },
        );
        processed += 1;
        if (result && !result.alreadyIssued) issued += 1;
      }
      cursor = members.length === 200 ? members[members.length - 1]!.id : undefined;
    } while (cursor);

    return reply.send({ data: { campaignId: campaign.id, processed, issued, mode: campaign.issuanceMode, occurrence } });
  });

  app.post("/admin/campaigns/:id/propose", async (request, reply) => {
    if (!request.adminId) throw new LoyaltyError("ADMIN_SESSION_REQUIRED", 403);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const approval = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${id} FOR UPDATE`;
      const campaign = await tx.campaign.findFirst({ where: { id, programId: request.programId, deletedAt: null } });
      if (!campaign) throw new LoyaltyError("CAMPAIGN_NOT_FOUND", 404);
      if (!["DRAFT", "REJECTED"].includes(campaign.approvalStatus)) throw new LoyaltyError("CAMPAIGN_NOT_A_DRAFT_PROPOSAL", 409);
      if (!campaign.justification?.trim()) throw new LoyaltyError("JUSTIFICATION_REQUIRED", 400);
      const approval = await createApprovalRequestWithClient(tx, {
        programId: request.programId, actionKey: "CAMPAIGN_ISSUANCE_PROPOSAL", requestedByType: "ADMIN_USER", requestedById: request.adminId!, requesterAdminId: request.adminId!,
        subjectType: "CAMPAIGN_ISSUANCE", subjectId: id,
        idempotencyKey: `campaign:${id}:${campaign.updatedAt.toISOString()}`,
        payload: { name: campaign.name, reason: campaign.justification, eventType: campaign.eventType, issuanceMode: campaign.issuanceMode, amount: campaign.multiplier, pointTypeId: campaign.pointTypeId, segmentId: campaign.segmentId, maxBudget: campaign.maxBudget, maxUsesPerMember: campaign.maxUsesPerMember, startsAt: campaign.startsAt?.toISOString() ?? null, endsAt: campaign.endsAt?.toISOString() ?? null },
        scopeContext: { pointTypeId: campaign.pointTypeId ?? undefined, amount: campaign.maxBudget || campaign.multiplier },
      });
      if (!approval) throw new LoyaltyError("POINT_ISSUANCE_WORKFLOW_NOT_CONFIGURED", 409);
      await tx.campaign.update({ where: { id }, data: { approvalStatus: "PENDING", isActive: false } });
      return approval;
    });
    return reply.status(201).send({ data: approval });
  });
  done();
}
