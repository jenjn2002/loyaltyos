import { rewardListQuerySchema, RewardsService } from "@loyaltyos/rewards";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { LoyaltyError } from "../lib/errors.js";
import { notificationsService } from "../lib/notifications-setup.js";
import { walletService } from "../lib/wallets.js";

const rewards = new RewardsService(prisma);

async function pricesForRewards(rewardIds: string[]) {
  const prices = await prisma.rewardPointPrice.findMany({
    where: {
      rewardId: { in: rewardIds },
      pointType: { isActive: true, archivedAt: null, redeemable: true },
    },
    include: {
      pointType: {
        select: { id: true, code: true, name: true, unitLabel: true, color: true },
      },
    },
    orderBy: { pointType: { sortOrder: "asc" } },
  });
  const byReward = new Map<string, typeof prices>();
  for (const price of prices) {
    const group = byReward.get(price.rewardId) ?? [];
    group.push(price);
    byReward.set(price.rewardId, group);
  }
  return byReward;
}

export function rewardsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get("/rewards/categories", async (request, reply) => {
    const rows = await prisma.reward.findMany({
      where: {
        programId: request.programId,
        deletedAt: null,
        isActive: true,
        category: { not: null },
      },
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    });
    return reply.send({ data: rows.flatMap((row) => (row.category ? [row.category] : [])) });
  });

  app.get("/rewards", async (request, reply) => {
    const query = rewardListQuerySchema.parse(request.query);
    const now = new Date();
    const where: Prisma.RewardWhereInput = {
      programId: request.programId,
      deletedAt: null,
      isActive: query.isActive ?? true,
      AND: [
        { OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] },
        { OR: [{ availableUntil: null }, { availableUntil: { gt: now } }] },
      ],
      ...(query.category ? { category: query.category } : {}),
      ...(query.tierRequired ? { tierRequired: query.tierRequired } : {}),
      ...(query.minPoints !== undefined || query.maxPoints !== undefined
        ? {
            pointsCost: {
              ...(query.minPoints !== undefined ? { gte: query.minPoints } : {}),
              ...(query.maxPoints !== undefined ? { lte: query.maxPoints } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.reward.findMany({
        where,
        include: { redemptions: { select: { id: true, memberId: true } } },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.reward.count({ where }),
    ]);
    const prices = await pricesForRewards(items.map((reward) => reward.id));
    return reply.send({
      data: {
        items: items.map((reward) => ({
          ...reward,
          pointPrices: prices.get(reward.id) ?? [],
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  });

  app.get("/rewards/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const reward = await rewards.detail(id);
    if (reward.programId !== request.programId) throw new LoyaltyError("REWARD_NOT_FOUND", 404);
    const prices = (await pricesForRewards([id])).get(id) ?? [];
    const wallets = request.memberId
      ? await walletService.memberWallets(request.memberId, request.programId)
      : [];
    const walletByType = new Map(wallets.map((wallet) => [wallet.pointTypeId, wallet]));
    return reply.send({
      data: {
        ...reward,
        pointPrices: prices.map((price) => ({
          ...price,
          availableBalance: walletByType.get(price.pointTypeId)?.balance ?? 0,
          eligible: (walletByType.get(price.pointTypeId)?.balance ?? 0) >= price.amount,
        })),
      },
    });
  });

  app.get("/members/me/reward-redemptions", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const redemptions = await prisma.rewardRedemption.findMany({
      where: { memberId: request.memberId, reward: { programId: request.programId } },
      orderBy: { redeemedAt: "desc" },
      take: 50,
      select: {
        id: true,
        rewardId: true,
        pointTypeId: true,
        pointsSpent: true,
        fulfillmentStatus: true,
        redeemedAt: true,
        fulfilledAt: true,
        cancelledAt: true,
        pointType: { select: { code: true, name: true, unitLabel: true } },
        reward: { select: { name: true, description: true } },
      },
    });
    return reply.send({ data: redemptions });
  });

  app.post(
    "/rewards/:id/redeem",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z.object({ pointTypeId: z.string().min(1) }).parse(request.body);
      if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
      const requestKey = request.headers["idempotency-key"];
      if (typeof requestKey !== "string" || requestKey.length < 8)
        throw new LoyaltyError("MISSING_IDEMPOTENCY_KEY", 400);
      const result = await walletService.redeemReward(
        id,
        request.memberId,
        request.programId,
        body.pointTypeId,
        requestKey,
      );
      if (!result.idempotent && result.redemption) {
        await audit(
          request.programId,
          request.actor,
          "CREDIT_REDEEM",
          "reward_redemption",
          result.redemption.id,
          {
            rewardId: id,
            memberId: request.memberId,
            pointTypeId: body.pointTypeId,
            amount: result.redemption.pointsSpent,
            transactionId: result.transaction.id,
            beforeBalance: result.transaction.balanceAfter + Math.abs(result.transaction.amount),
            afterBalance: result.transaction.balanceAfter,
          },
          `Redeem reward ${id}`,
        );
        const member = await prisma.member.findFirst({
          where: { id: request.memberId, programId: request.programId },
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
        void notificationsService.sendTrigger(
          request.programId,
          "credit.redeemed",
          request.memberId,
          {
            member,
            rewardId: id,
            amount: result.redemption.pointsSpent,
            pointTypeId: body.pointTypeId,
            _locale: member?.locale ?? member?.program.defaultLocale ?? "en-US",
          },
        );
      }
      return reply.status(result.idempotent ? 200 : 201).send({ data: result });
    },
  );

  done();
}
