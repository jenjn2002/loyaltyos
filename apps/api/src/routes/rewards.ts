import { rewardListQuerySchema, RewardsService } from "@loyaltyos/rewards";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { creditService, type CreditKind } from "../lib/credits.js";
import { ensureCreditSettings } from "../lib/credit-settings.js";
import { LoyaltyError } from "../lib/errors.js";
import { notificationsService } from "../lib/notifications-setup.js";

const rewards = new RewardsService(prisma);

export function rewardsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  // GET /rewards — public catalog with filters
  app.get("/rewards", async (request, reply) => {
    const query = rewardListQuerySchema.parse(request.query);
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const result = await rewards.list(programId, query);
    return reply.send({ data: result });
  });

  // GET /rewards/:id — detail with optional ?memberId= for eligibility
  app.get("/rewards/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const memberId = (request.query as { memberId?: string }).memberId;
    const result = await rewards.detail(id, memberId);
    return reply.send({ data: result });
  });

  app.get("/members/me/reward-redemptions", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const settings = await ensureCreditSettings(request.programId);
    if (settings.values.employee_fulfillment_visibility !== "MEMBER_READ_ONLY") {
      throw new LoyaltyError("REWARD_FULFILLMENT_NOT_VISIBLE", 403);
    }
    const redemptions = await prisma.rewardRedemption.findMany({
      where: { memberId: request.memberId, reward: { programId: request.programId } },
      orderBy: { redeemedAt: "desc" },
      take: 50,
      select: {
        id: true,
        rewardId: true,
        pointsSpent: true,
        fulfillmentStatus: true,
        redeemedAt: true,
        fulfilledAt: true,
        cancelledAt: true,
        reward: { select: { name: true, description: true } },
      },
    });
    return reply.send({ data: redemptions });
  });

  // POST /rewards/:id/redeem — redeem a reward (rate-limited)
  app.post(
    "/rewards/:id/redeem",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z
        .object({
          rewardId: z.string().min(1).optional(),
          idempotencyKey: z.string().min(1).optional(),
          creditType: z.enum(["P", "R"]).optional(),
        })
        .parse(request.body ?? {});
      const memberId = request.memberId;
      if (!memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
      const key = body.idempotencyKey ?? (request.headers["idempotency-key"] as string | undefined) ?? `reward:${id}:${memberId}:${String(Date.now())}`;
      const rewardId = body.rewardId ?? id;
      const result = body.creditType
        ? await creditService.redeemReward(rewardId, memberId, request.programId, {
            creditType: body.creditType as CreditKind,
            idempotencyKey: key,
        })
        : await rewards.redeem(rewardId, memberId, key);
      const redemptionId = "redemptionId" in result ? result.redemptionId : result.redemption.id;
      const transactionId = "transactionId" in result ? result.transactionId : result.transaction.transactionId;
      const amount = "amount" in result ? result.amount : result.transaction.amount;
      const creditTransaction = await prisma.creditTransaction.findUnique({ where: { id: transactionId }, select: { balanceAfter: true, amount: true, creditType: true } });
      await audit(request.programId, request.actor, "CREDIT_REDEEM", "reward_redemption", redemptionId ?? null, {
        rewardId,
        memberId,
        amount,
        transactionId,
        creditType: creditTransaction?.creditType ?? body.creditType ?? "LEGACY_POINTS",
        beforeBalance: creditTransaction ? creditTransaction.balanceAfter + Math.abs(creditTransaction.amount) : null,
        afterBalance: creditTransaction?.balanceAfter ?? null,
      }, `Redeem reward ${rewardId}`);
      const member = await prisma.member.findFirst({ where: { id: memberId, programId: request.programId }, select: { id: true, email: true, phone: true, firstName: true, lastName: true } });
      void notificationsService.sendTrigger(request.programId, "credit.redeemed", memberId, { member, rewardId, amount, creditType: body.creditType ?? "LEGACY_POINTS", _locale: "es-MX" });
      return reply.status(201).send({ data: result });
    },
  );

  done();
}
