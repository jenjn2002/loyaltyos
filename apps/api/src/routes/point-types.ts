import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import {
  ensureBuiltInPointTypes,
  listCustomPointTypes,
  listPointTypes,
  memberPointWallets,
  adjustPointWallet,
  isBuiltInCreditType,
  POINT_TYPE_CODES,
  POINT_TYPE_EXPIRY_MODES,
} from "../lib/point-types.js";
import { LoyaltyError } from "../lib/errors.js";
import { requireAdmin } from "../plugins/require-admin.js";

const pointTypeFields = z.object({
  code: z
    .string()
    .regex(POINT_TYPE_CODES, "Code must be 1-32 letters, numbers, hyphens or underscores"),
  name: z.string().trim().min(1).max(120),
  unitLabel: z.string().trim().min(1).max(40).default("points"),
  description: z.string().max(500).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  expiryMode: z.enum(POINT_TYPE_EXPIRY_MODES).default("NEVER"),
  expiryDays: z.number().int().positive().nullable().optional(),
  allowNegativeBalance: z.boolean().default(false),
  allowManualAdjustment: z.boolean().default(true),
  transferable: z.boolean().default(false),
  redeemable: z.boolean().default(false),
  exchangeable: z.boolean().default(false),
  cashEligible: z.boolean().default(false),
  isActive: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional(),
});

function normalizeExpiry(body: z.infer<typeof pointTypeFields>) {
  if (body.cashEligible && !body.exchangeable)
    throw new LoyaltyError("POINT_CASH_REQUIRES_EXCHANGE", 400);
  if (body.expiryMode === "NEVER") return { ...body, expiryDays: null };
  if (!body.expiryDays) throw new LoyaltyError("POINT_EXPIRY_DAYS_REQUIRED", 400);
  return body;
}

function normalizeExpiryPatch(
  body: Partial<z.infer<typeof pointTypeFields>>,
  existing: {
    expiryMode: string;
    expiryDays: number | null;
    cashEligible: boolean;
    exchangeable: boolean;
  },
) {
  const expiryMode = body.expiryMode ?? existing.expiryMode;
  const expiryDays = body.expiryDays ?? existing.expiryDays;
  const cashEligible = body.cashEligible ?? existing.cashEligible;
  const exchangeable = body.exchangeable ?? existing.exchangeable;
  if (cashEligible && !exchangeable) throw new LoyaltyError("POINT_CASH_REQUIRES_EXCHANGE", 400);
  if (expiryMode === "NEVER") return { ...body, expiryDays: null };
  if (expiryMode === "AFTER_DAYS" && !expiryDays)
    throw new LoyaltyError("POINT_EXPIRY_DAYS_REQUIRED", 400);
  return body;
}

export function pointTypesRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get("/point-types", async (request, reply) => {
    return reply.send({ data: await listCustomPointTypes(request.programId, false) });
  });

  app.get("/members/me/point-wallets", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    return reply.send({ data: await memberPointWallets(request.memberId, request.programId) });
  });

  app.get("/admin/point-types", { preHandler: [requireAdmin] }, async (request, reply) => {
    return reply.send({ data: await listPointTypes(request.programId, true) });
  });

  app.post("/admin/point-types", { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = normalizeExpiry(pointTypeFields.parse(request.body));
    await ensureBuiltInPointTypes(request.programId);
    if (isBuiltInCreditType(body.code)) throw new LoyaltyError("POINT_TYPE_CODE_RESERVED", 409);
    const pointType = await prisma.pointTypeDefinition.create({
      data: {
        ...body,
        programId: request.programId,
        metadata: body.metadata as never,
      },
    });
    await audit(
      request.programId,
      request.actor,
      "CONFIG_CHANGE",
      "point_type_definition",
      pointType.id,
      body,
    );
    return reply.status(201).send({ data: pointType });
  });

  app.patch("/admin/point-types/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const parsedBody = pointTypeFields.partial().parse(request.body);
    const existing = await prisma.pointTypeDefinition.findFirst({
      where: { id: params.id, programId: request.programId },
    });
    if (!existing) throw new LoyaltyError("POINT_TYPE_NOT_FOUND", 404);
    if (isBuiltInCreditType(existing.code))
      throw new LoyaltyError("POINT_TYPE_USE_CREDITS_MODULE", 409);
    const body = normalizeExpiryPatch(parsedBody, existing);
    if (body.code && body.code !== existing.code) {
      const conflict = await prisma.pointTypeDefinition.findFirst({
        where: { programId: request.programId, code: body.code, NOT: { id: params.id } },
      });
      if (conflict) throw new LoyaltyError("POINT_TYPE_CODE_EXISTS", 409);
    }
    const pointType = await prisma.pointTypeDefinition.update({
      where: { id: params.id },
      data: {
        ...body,
        metadata: body.metadata === undefined ? undefined : (body.metadata as never),
      },
    });
    await audit(
      request.programId,
      request.actor,
      "CONFIG_CHANGE",
      "point_type_definition",
      pointType.id,
      body,
    );
    return reply.send({ data: pointType });
  });

  app.post(
    "/admin/point-types/:id/adjust",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = z
        .object({
          memberId: z.string().min(1),
          amount: z
            .number()
            .int()
            .refine((value) => value !== 0, "Amount cannot be zero"),
          reason: z.string().trim().min(1).max(500),
          expiresAt: z.string().datetime().optional(),
        })
        .parse(request.body);
      const idempotencyKey = request.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8)
        throw new LoyaltyError("MISSING_IDEMPOTENCY_KEY", 400);
      const transaction = await adjustPointWallet({
        programId: request.programId,
        memberId: body.memberId,
        pointTypeId: params.id,
        amount: body.amount,
        reason: body.reason,
        actorId: request.actor.id,
        actorType: request.actor.type,
        idempotencyKey,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      });
      await audit(
        request.programId,
        request.actor,
        "CONFIG_CHANGE",
        "point_wallet_adjustment",
        transaction.id,
        { pointTypeId: params.id, ...body },
      );
      return reply.send({ data: transaction });
    },
  );

  done();
}
