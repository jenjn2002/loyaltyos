import { TiersService } from "@loyaltyos/badges";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { LoyaltyError } from "../../lib/errors.js";

const tiers = new TiersService(prisma);

const createSchema = z.object({
  pointTypeId: z.string().min(1),
  name: z.string().min(1),
  rank: z.number().int().min(1),
  minPoints: z.number().int().min(0),
  color: z.string().optional(),
  iconUrl: z.string().optional(),
  benefits: z.record(z.unknown()).optional(),
});

const updateSchema = z.object({
  pointTypeId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  rank: z.number().int().min(1).optional(),
  minPoints: z.number().int().min(0).optional(),
  color: z.string().optional(),
  iconUrl: z.string().optional(),
  benefits: z.record(z.unknown()).optional(),
});

const reorderSchema = z.object({
  tierIds: z.array(z.string().min(1)).min(1),
});

async function assertTierPointType(programId: string, pointTypeId: string, excludeTierId?: string) {
  const [pointType, conflictingTier] = await Promise.all([
    prisma.pointTypeDefinition.findFirst({
      where: { id: pointTypeId, programId, isActive: true, archivedAt: null },
      select: { id: true },
    }),
    prisma.tier.findFirst({
      where: {
        programId,
        pointTypeId: { not: pointTypeId },
        ...(excludeTierId ? { id: { not: excludeTierId } } : {}),
      },
      select: { id: true },
    }),
  ]);
  if (!pointType) throw new LoyaltyError("POINT_TYPE_NOT_FOUND", 404);
  if (conflictingTier) throw new LoyaltyError("TIER_POINT_TYPE_CONFLICT", 409);
}

async function ownedTier(id: string, programId: string) {
  const tier = await prisma.tier.findFirst({ where: { id, programId } });
  if (!tier) throw new LoyaltyError("TIER_NOT_FOUND", 404);
  return tier;
}

export function adminTiersRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  // POST /admin/tiers — Create tier
  app.post("/admin/tiers", async (request, reply) => {
    const body = createSchema.parse(request.body);
    const programId = request.programId;
    await assertTierPointType(programId, body.pointTypeId);
    const tier = await tiers.create({ ...body, programId });
    return reply.status(201).send({ data: tier });
  });

  // GET /admin/tiers — List tiers (ordered by rank)
  app.get("/admin/tiers", async (request, reply) => {
    const programId = request.programId;
    const result = await tiers.list(programId);
    return reply.send({ data: result });
  });

  // GET /admin/tiers/stats — Tier distribution stats (pyramid)
  app.get("/admin/tiers/stats", async (request, reply) => {
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const stats = await tiers.stats(programId);
    return reply.send({ data: stats });
  });

  // GET /admin/tiers/:id — Get tier by id
  app.get("/admin/tiers/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await ownedTier(id, request.programId);
    const tier = await tiers.getById(id);
    return reply.send({ data: tier });
  });

  // GET /admin/tiers/:id/benefits — Get tier benefits
  app.get("/admin/tiers/:id/benefits", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await ownedTier(id, request.programId);
    const benefits = await tiers.benefits(id);
    return reply.send({ data: benefits });
  });

  // PATCH /admin/tiers/:id — Update tier
  app.patch("/admin/tiers/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateSchema.parse(request.body);
    await ownedTier(id, request.programId);
    if (body.pointTypeId) await assertTierPointType(request.programId, body.pointTypeId, id);
    const tier = await tiers.update(id, body);
    return reply.send({ data: tier });
  });

  // DELETE /admin/tiers/:id — Delete tier
  app.delete("/admin/tiers/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await ownedTier(id, request.programId);
    await tiers.delete(id);
    return reply.status(204).send();
  });

  // PATCH /admin/tiers/reorder — Reorder tier ranks
  app.patch("/admin/tiers/reorder", async (request, reply) => {
    const body = reorderSchema.parse(request.body);
    const programId = request.programId;
    const current = await prisma.tier.findMany({ where: { programId }, select: { id: true } });
    if (
      current.length !== body.tierIds.length ||
      current.some((tier) => !body.tierIds.includes(tier.id))
    ) {
      throw new LoyaltyError("TIER_REORDER_INCOMPLETE", 400);
    }
    await prisma.$transaction(async (tx) => {
      for (const [index, tierId] of body.tierIds.entries()) {
        await tx.tier.update({ where: { id: tierId }, data: { rank: -(index + 1) } });
      }
      for (const [index, tierId] of body.tierIds.entries()) {
        await tx.tier.update({ where: { id: tierId }, data: { rank: index + 1 } });
      }
    });
    const result = await tiers.list(programId);
    return reply.send({ data: result });
  });

  done();
}
