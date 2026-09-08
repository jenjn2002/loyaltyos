import {
  restockSchema,
  rewardCreateSchema,
  RewardsService,
  rewardUpdateSchema,
} from "@loyaltyos/rewards";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { requireAdmin } from "../../plugins/require-admin.js";

const rewards = new RewardsService(prisma);

export function adminRewardsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.addHook("preHandler", requireAdmin);
  // POST /admin/rewards — create a reward
  app.post("/admin/rewards", async (request, reply) => {
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const body = rewardCreateSchema.parse({ ...(request.body as object), programId });
    const reward = await rewards.create(body);
    return reply.status(201).send({ data: reward });
  });

  // GET /admin/rewards — list all rewards for a program
  app.get("/admin/rewards", async (request, reply) => {
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const query = z
      .object({
        category: z.string().optional(),
        isActive: z
          .enum(["true", "false"])
          .optional()
          .transform((v) => {
            if (v === "true") return true;
            if (v === "false") return false;
            return undefined;
          }),
        minPoints: z.coerce.number().int().min(0).optional(),
        maxPoints: z.coerce.number().int().min(0).optional(),
        tierRequired: z.string().optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
      })
      .parse(request.query);

    const result = await rewards.list(programId, query);
    return reply.send({ data: result });
  });

  // GET /admin/rewards/:id — get a single reward
  app.get("/admin/rewards/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const reward = await rewards.getById(id);
    return reply.send({ data: reward });
  });

  // PATCH /admin/rewards/:id — update a reward
  app.patch("/admin/rewards/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = rewardUpdateSchema.parse(request.body);
    const reward = await rewards.update(id, body);
    return reply.send({ data: reward });
  });

  // DELETE /admin/rewards/:id — soft delete a reward
  app.delete("/admin/rewards/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await rewards.softDelete(id);
    return reply.status(204).send();
  });

  // POST /admin/rewards/:id/archive — archive a reward
  app.post("/admin/rewards/:id/archive", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await rewards.archive(id);
    return reply.status(204).send();
  });

  // POST /admin/rewards/:id/publish — publish a reward
  app.post("/admin/rewards/:id/publish", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const reward = await rewards.publish(id);
    return reply.send({ data: reward });
  });

  // POST /admin/rewards/:id/restock — add stock to a reward
  app.post("/admin/rewards/:id/restock", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { qty } = restockSchema.parse(request.body);
    const reward = await rewards.restock(id, qty);
    return reply.send({ data: reward });
  });

  app.get("/admin/rewards/:id/redemptions", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const query = z.object({
      status: z.enum(["PENDING", "FULFILLED", "CANCELLED"]).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(request.query);
    const where = {
      rewardId: id,
      ...(query.status ? { fulfillmentStatus: query.status } : {}),
      reward: { programId: request.programId },
    };
    const [items, total] = await Promise.all([
      prisma.rewardRedemption.findMany({
        where,
        include: { member: { select: { id: true, email: true, firstName: true, lastName: true } }, reward: { select: { name: true, pointsCost: true } } },
        orderBy: { redeemedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.rewardRedemption.count({ where }),
    ]);
    return reply.send({ data: { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) } });
  });

  app.patch("/admin/rewards/redemptions/:id/status", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ status: z.enum(["PENDING", "FULFILLED", "CANCELLED"]), reason: z.string().trim().min(1) }).parse(request.body);
    const redemption = await prisma.rewardRedemption.findFirst({ where: { id, reward: { programId: request.programId } } });
    if (!redemption) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Redemption not found" } });
    const updated = await prisma.rewardRedemption.update({ where: { id }, data: {
      fulfillmentStatus: body.status,
      fulfilledAt: body.status === "FULFILLED" ? new Date() : redemption.fulfilledAt,
      cancelledAt: body.status === "CANCELLED" ? new Date() : redemption.cancelledAt,
    } });
    await audit(request.programId, request.actor, "CREDIT_REDEEM", "reward_redemption", id, { status: body.status }, body.reason);
    return reply.send({ data: updated });
  });

  done();
}
