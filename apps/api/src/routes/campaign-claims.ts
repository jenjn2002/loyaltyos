import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { LoyaltyError } from "../lib/errors.js";
import { walletService } from "../lib/wallets.js";

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["PENDING", "CLAIMED", "EXPIRED"]).optional(),
});

export function campaignClaimsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get("/members/me/campaign-claims", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const query = pageSchema.parse(request.query);
    const where = {
      memberId: request.memberId,
      ...(query.status ? { status: query.status } : {}),
      campaign: { programId: request.programId, deletedAt: null },
    };
    const [items, total] = await Promise.all([
      prisma.campaignClaim.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          pointsAwarded: true,
          status: true,
          claimedAt: true,
          createdAt: true,
          campaign: {
            select: {
              id: true,
              name: true,
              description: true,
              eventType: true,
              pointType: { select: { id: true, code: true, name: true, unitLabel: true } },
            },
          },
        },
      }),
      prisma.campaignClaim.count({ where }),
    ]);
    return reply.send({
      data: {
        items,
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  });

  app.post("/members/me/campaign-claims/:id/claim", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "CampaignClaim" WHERE "id" = ${id} FOR UPDATE`;
      const claim = await tx.campaignClaim.findFirst({
        where: {
          id,
          memberId: request.memberId!,
          campaign: { programId: request.programId, deletedAt: null },
        },
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
              programId: true,
              pointTypeId: true,
              approvalStatus: true,
              isActive: true,
            },
          },
        },
      });
      if (!claim) throw new LoyaltyError("CAMPAIGN_CLAIM_NOT_FOUND", 404);
      if (claim.status === "CLAIMED") return { claim, idempotent: true, transactionId: null };
      if (claim.status !== "PENDING") throw new LoyaltyError("CAMPAIGN_CLAIM_NOT_AVAILABLE", 409);
      if (!claim.campaign.isActive || !["NOT_REQUIRED", "APPROVED"].includes(claim.campaign.approvalStatus)) {
        throw new LoyaltyError("CAMPAIGN_CLAIM_NOT_AVAILABLE", 409);
      }
      const issued = await walletService.issueWithTransaction(tx, {
        memberId: claim.memberId,
        programId: claim.campaign.programId,
        pointTypeId: claim.campaign.pointTypeId ?? undefined,
        amount: claim.pointsAwarded,
        source: `campaign:${claim.campaign.id}`,
        reason: `Claimed campaign: ${claim.campaign.name}`,
        idempotencyKey: `campaign-claim:${claim.id}`,
        metadata: { campaignId: claim.campaign.id, claimId: claim.id },
      });
      const updated = await tx.campaignClaim.update({
        where: { id: claim.id },
        data: { status: "CLAIMED", claimedAt: new Date() },
      });
      return { claim: updated, idempotent: issued.idempotent, transactionId: issued.transactionId };
    });
    return reply.send({ data: result });
  });

  done();
}
