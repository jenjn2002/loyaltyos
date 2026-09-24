import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { createdByForEntities } from "../../lib/created-by.js";
import { LoyaltyError } from "../../lib/errors.js";
import { notificationsService } from "../../lib/notifications-setup.js";
import { requireCapability } from "../../lib/permissions.js";
import { walletService } from "../../lib/wallets.js";

const priceSchema = z.object({
  pointTypeId: z.string().min(1),
  amount: z.number().int().positive(),
});

const rewardInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(5000).nullable().optional(),
  pointPrices: z.array(priceSchema).min(1).max(50),
  stock: z.number().int().min(0).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  category: z.string().trim().min(1).max(80).nullable().optional(),
  tierRequired: z.string().trim().max(120).nullable().optional(),
  availableFrom: z.string().datetime().nullable().optional(),
  availableUntil: z.string().datetime().nullable().optional(),
  isActive: z.boolean().default(false),
});

async function validatePrices(
  programId: string,
  prices: z.infer<typeof priceSchema>[],
): Promise<void> {
  if (new Set(prices.map((price) => price.pointTypeId)).size !== prices.length)
    throw new LoyaltyError("REWARD_DUPLICATE_POINT_TYPE", 400);
  const valid = await prisma.pointTypeDefinition.count({
    where: {
      programId,
      id: { in: prices.map((price) => price.pointTypeId) },
      isActive: true,
      archivedAt: null,
      redeemable: true,
    },
  });
  if (valid !== prices.length) throw new LoyaltyError("REWARD_POINT_TYPE_NOT_REDEEMABLE", 422);
}

function availabilityDates(input: {
  availableFrom?: string | null;
  availableUntil?: string | null;
}) {
  const availableFrom = input.availableFrom ? new Date(input.availableFrom) : null;
  const availableUntil = input.availableUntil ? new Date(input.availableUntil) : null;
  if (availableFrom && availableUntil && availableUntil <= availableFrom)
    throw new LoyaltyError("REWARD_AVAILABILITY_INVALID", 400);
  return { availableFrom, availableUntil };
}

const rewardInclude = {
  pointPrices: {
    include: {
      pointType: {
        select: { id: true, code: true, name: true, unitLabel: true, color: true },
      },
    },
    orderBy: { pointType: { sortOrder: "asc" as const } },
  },
  redemptions: { select: { id: true, memberId: true } },
} satisfies Prisma.RewardInclude;

export function adminRewardsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.post(
    "/admin/rewards",
    { preHandler: [requireCapability("reward.manage")] },
    async (request, reply) => {
      const body = rewardInputSchema.parse(request.body);
      await validatePrices(request.programId, body.pointPrices);
      const dates = availabilityDates(body);
      const reward = await prisma.reward.create({
        data: {
          programId: request.programId,
          name: body.name,
          description: body.description,
          // Kept as a compatibility projection for older API clients.
          pointsCost: body.pointPrices[0]?.amount ?? 1,
          stock: body.stock,
          imageUrl: body.imageUrl,
          category: body.category,
          tierRequired: body.tierRequired,
          ...dates,
          isActive: body.isActive,
          pointPrices: {
            create: body.pointPrices.map((price) => ({
              programId: request.programId,
              pointTypeId: price.pointTypeId,
              amount: price.amount,
            })),
          },
        },
        include: rewardInclude,
      });
      await audit(request.programId, request.actor, "UPDATE_REWARD", "reward", reward.id, {
        created: true,
        pointPrices: body.pointPrices,
      });
      return reply.status(201).send({ data: reward });
    },
  );

  app.get(
    "/admin/rewards",
    { preHandler: [requireCapability("reward.view")] },
    async (request, reply) => {
      const query = z
        .object({
          category: z.string().optional(),
          isActive: z.enum(["true", "false"]).optional(),
          pointTypeId: z.string().optional(),
          minPoints: z.coerce.number().int().min(0).optional(),
          maxPoints: z.coerce.number().int().min(0).optional(),
          tierRequired: z.string().optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(20),
        })
        .parse(request.query);
      const where: Prisma.RewardWhereInput = {
        programId: request.programId,
        deletedAt: null,
        ...(query.category ? { category: query.category } : {}),
        ...(query.isActive ? { isActive: query.isActive === "true" } : {}),
        ...(query.tierRequired ? { tierRequired: query.tierRequired } : {}),
        ...([query.pointTypeId, query.minPoints, query.maxPoints].some((value) => value != null)
          ? {
              pointPrices: {
                some: {
                  ...(query.pointTypeId ? { pointTypeId: query.pointTypeId } : {}),
                  ...(query.minPoints != null || query.maxPoints != null
                    ? {
                        amount: {
                          ...(query.minPoints != null ? { gte: query.minPoints } : {}),
                          ...(query.maxPoints != null ? { lte: query.maxPoints } : {}),
                        },
                      }
                    : {}),
                },
              },
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.reward.findMany({
          where,
          include: rewardInclude,
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.reward.count({ where }),
      ]);
      const creators = await createdByForEntities(
        request.programId,
        "reward",
        items.map((reward) => reward.id),
      );
      return reply.send({
        data: {
          items: items.map((reward) => ({ ...reward, createdBy: creators.get(reward.id) ?? null })),
          total,
          page: query.page,
          pageSize: query.pageSize,
          totalPages: Math.ceil(total / query.pageSize),
        },
      });
    },
  );

  app.get(
    "/admin/rewards/:id",
    { preHandler: [requireCapability("reward.view")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const reward = await prisma.reward.findFirst({
        where: { id, programId: request.programId, deletedAt: null },
        include: rewardInclude,
      });
      if (!reward) throw new LoyaltyError("REWARD_NOT_FOUND", 404);
      return reply.send({ data: reward });
    },
  );

  app.patch(
    "/admin/rewards/:id",
    { preHandler: [requireCapability("reward.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = rewardInputSchema.partial().parse(request.body);
      const existing = await prisma.reward.findFirst({
        where: { id, programId: request.programId, deletedAt: null },
      });
      if (!existing) throw new LoyaltyError("REWARD_NOT_FOUND", 404);
      if (body.pointPrices) await validatePrices(request.programId, body.pointPrices);
      const dates = availabilityDates({
        availableFrom:
          body.availableFrom === undefined
            ? existing.availableFrom?.toISOString()
            : body.availableFrom,
        availableUntil:
          body.availableUntil === undefined
            ? existing.availableUntil?.toISOString()
            : body.availableUntil,
      });
      const reward = await prisma.$transaction(async (tx) => {
        if (body.pointPrices) {
          await tx.rewardPointPrice.deleteMany({ where: { rewardId: id } });
          await tx.rewardPointPrice.createMany({
            data: body.pointPrices.map((price) => ({
              rewardId: id,
              programId: request.programId,
              pointTypeId: price.pointTypeId,
              amount: price.amount,
            })),
          });
        }
        return tx.reward.update({
          where: { id },
          data: {
            name: body.name,
            description: body.description,
            pointsCost: body.pointPrices?.[0]?.amount,
            stock: body.stock,
            imageUrl: body.imageUrl,
            category: body.category,
            tierRequired: body.tierRequired,
            ...dates,
            isActive: body.isActive,
          },
          include: rewardInclude,
        });
      });
      await audit(request.programId, request.actor, "UPDATE_REWARD", "reward", id, body);
      return reply.send({ data: reward });
    },
  );

  app.delete(
    "/admin/rewards/:id",
    { preHandler: [requireCapability("reward.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const changed = await prisma.reward.updateMany({
        where: { id, programId: request.programId },
        data: { deletedAt: new Date(), isActive: false },
      });
      if (changed.count !== 1) throw new LoyaltyError("REWARD_NOT_FOUND", 404);
      await audit(request.programId, request.actor, "UPDATE_REWARD", "reward", id, {
        operation: "DELETE",
        deleted: true,
        mode: "SOFT_DELETE",
      });
      return reply.status(204).send();
    },
  );

  app.post(
    "/admin/rewards/:id/archive",
    { preHandler: [requireCapability("reward.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      await prisma.reward.updateMany({
        where: { id, programId: request.programId },
        data: { isActive: false },
      });
      return reply.status(204).send();
    },
  );

  app.post(
    "/admin/rewards/:id/publish",
    { preHandler: [requireCapability("reward.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const prices = await prisma.rewardPointPrice.count({
        where: { rewardId: id, reward: { programId: request.programId } },
      });
      if (prices === 0) throw new LoyaltyError("REWARD_PRICE_REQUIRED", 409);
      const existing = await prisma.reward.findFirst({
        where: { id, programId: request.programId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new LoyaltyError("REWARD_NOT_FOUND", 404);
      const reward = await prisma.reward.update({
        where: { id },
        data: { isActive: true },
        include: rewardInclude,
      });
      return reply.send({ data: reward });
    },
  );

  app.post(
    "/admin/rewards/:id/restock",
    { preHandler: [requireCapability("reward.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const { qty } = z.object({ qty: z.number().int().positive() }).parse(request.body);
      const existing = await prisma.reward.findFirst({
        where: { id, programId: request.programId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new LoyaltyError("REWARD_NOT_FOUND", 404);
      const reward = await prisma.reward.update({
        where: { id },
        data: { stock: { increment: qty } },
        include: rewardInclude,
      });
      return reply.send({ data: reward });
    },
  );

  app.get(
    "/admin/rewards/:id/redemptions",
    { preHandler: [requireCapability("reward.view")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const query = z
        .object({
          status: z.enum(["PENDING", "FULFILLED", "CANCELLED"]).optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(50),
        })
        .parse(request.query);
      const where = {
        rewardId: id,
        ...(query.status ? { fulfillmentStatus: query.status } : {}),
        reward: { programId: request.programId },
      };
      const [items, total] = await Promise.all([
        prisma.rewardRedemption.findMany({
          where,
          include: {
            member: {
              select: { id: true, email: true, firstName: true, lastName: true },
            },
            reward: { select: { name: true } },
            pointType: { select: { id: true, code: true, name: true, unitLabel: true } },
          },
          orderBy: { redeemedAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.rewardRedemption.count({ where }),
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
    },
  );

  app.patch(
    "/admin/rewards/redemptions/:id/status",
    { preHandler: [requireCapability("reward.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z
        .object({
          status: z.enum(["FULFILLED", "CANCELLED"]),
          reason: z.string().trim().min(1).max(500),
        })
        .parse(request.body);
      const current = await prisma.rewardRedemption.findFirst({
        where: { id, reward: { programId: request.programId } },
        include: {
          approvalRequest: { select: { status: true } },
          member: {
            select: {
              id: true,
              email: true,
              phone: true,
              firstName: true,
              lastName: true,
              locale: true,
              program: { select: { defaultLocale: true } },
            },
          },
        },
      });
      if (!current) throw new LoyaltyError("REWARD_REDEMPTION_NOT_FOUND", 404);
      if (current.fulfillmentStatus !== "PENDING")
        throw new LoyaltyError("REWARD_FULFILLMENT_STATUS_INVALID", 409);
      if (
        body.status === "FULFILLED" &&
        current.approvalRequest &&
        current.approvalRequest.status !== "APPROVED"
      )
        throw new LoyaltyError("REWARD_APPROVAL_REQUIRED", 409);
      const updated =
        body.status === "CANCELLED"
          ? await walletService.cancelRewardRedemption(
              request.programId,
              id,
              request.actor,
              body.reason,
            )
          : await prisma.rewardRedemption.update({
              where: { id },
              data: {
                fulfillmentStatus: body.status,
                fulfilledAt: new Date(),
              },
            });
      await audit(
        request.programId,
        request.actor,
        "CREDIT_REDEEM",
        "reward_redemption",
        id,
        { previousStatus: current.fulfillmentStatus, status: body.status },
        body.reason,
      );
      void notificationsService.sendTrigger(
        request.programId,
        "reward.fulfillment_changed",
        current.memberId,
        {
          member: current.member,
          redemptionId: id,
          status: body.status,
          _locale: current.member.locale,
        },
      );
      return reply.send({ data: updated });
    },
  );

  done();
}
