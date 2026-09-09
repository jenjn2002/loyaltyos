import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { LoyaltyError } from "../lib/errors.js";
import { requireCapability } from "../lib/permissions.js";
import {
  POINT_EXPIRY_MODES,
  POINT_GIVE_SOURCES,
  POINT_TYPE_CODES,
  walletService,
} from "../lib/wallets.js";

const transferRuleSchema = z.object({
  destinationPointTypeId: z.string().min(1),
  sourceAmount: z.number().int().positive().default(1),
  destinationAmount: z.number().int().positive().default(1),
  isActive: z.boolean().default(true),
});

const pointTypeInputSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(POINT_TYPE_CODES, "Code must be 1-32 letters, numbers, hyphens or underscores")
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(120),
  unitLabel: z.string().trim().min(1).max(40),
  description: z.string().trim().max(500).nullable(),
  icon: z.string().trim().max(80).nullable(),
  color: z.string().trim().max(32).nullable(),
  expiryMode: z.enum(POINT_EXPIRY_MODES),
  expiryDays: z.number().int().positive().nullable(),
  fixedExpiryAt: z.string().datetime().nullable(),
  expiryWarningDays: z.array(z.number().int().nonnegative()).max(10),
  allowNegativeBalance: z.boolean(),
  allowManualAdjustment: z.boolean(),
  transferable: z.boolean(),
  redeemable: z.boolean(),
  exchangeable: z.boolean(),
  cashEligible: z.boolean(),
  bankEnabled: z.boolean(),
  giveEnabled: z.boolean(),
  giveSource: z.enum(POINT_GIVE_SOURCES),
  allowanceAmount: z.number().int().nonnegative().nullable(),
  allowanceCycleDays: z.number().int().positive().max(3660),
  allowanceCarryOver: z.boolean(),
  pairLimit: z.number().int().positive().nullable(),
  pairLimitPeriodDays: z.number().int().positive().max(3660),
  requireGiveMessage: z.boolean(),
  allowMultiRecipient: z.boolean(),
  maxRecipients: z.number().int().positive().max(500),
  showOnMemberProfile: z.boolean(),
  showZeroBalance: z.boolean(),
  isPrimary: z.boolean(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  metadata: z.record(z.unknown()),
  transferRules: z.array(transferRuleSchema).max(100),
});

const createPointTypeSchema = pointTypeInputSchema.partial().required({
  code: true,
  name: true,
});
const patchPointTypeSchema = pointTypeInputSchema.partial();

const pointTypeDefaults = {
  unitLabel: "points",
  description: null,
  icon: null,
  color: null,
  expiryMode: "NEVER" as const,
  expiryDays: null,
  fixedExpiryAt: null,
  expiryWarningDays: [30, 7],
  allowNegativeBalance: false,
  allowManualAdjustment: true,
  transferable: false,
  redeemable: false,
  exchangeable: false,
  cashEligible: false,
  bankEnabled: false,
  giveEnabled: false,
  giveSource: "BALANCE" as const,
  allowanceAmount: null,
  allowanceCycleDays: 30,
  allowanceCarryOver: false,
  pairLimit: null,
  pairLimitPeriodDays: 30,
  requireGiveMessage: true,
  allowMultiRecipient: true,
  maxRecipients: 500,
  showOnMemberProfile: true,
  showZeroBalance: true,
  isPrimary: false,
  sortOrder: 0,
  isActive: true,
  metadata: {},
  transferRules: [],
};

type PointTypeInput = z.infer<typeof pointTypeInputSchema>;

function normalizePointType(input: PointTypeInput) {
  if (!input.isActive && input.isPrimary)
    throw new LoyaltyError("POINT_PRIMARY_MUST_BE_ACTIVE", 400);
  if (input.cashEligible && !input.exchangeable)
    throw new LoyaltyError("POINT_CASH_REQUIRES_EXCHANGE", 400);
  if (input.expiryMode === "AFTER_DAYS" && !input.expiryDays)
    throw new LoyaltyError("POINT_EXPIRY_DAYS_REQUIRED", 400);
  if (input.expiryMode === "FIXED_DATE" && !input.fixedExpiryAt)
    throw new LoyaltyError("POINT_FIXED_EXPIRY_REQUIRED", 400);
  if (
    input.giveEnabled &&
    (input.giveSource === "ALLOWANCE" || input.giveSource === "BOTH") &&
    input.allowanceAmount == null
  )
    throw new LoyaltyError("POINT_ALLOWANCE_NOT_CONFIGURED", 400);
  const duplicateDestinations = input.transferRules.some(
    (rule, index) =>
      input.transferRules.findIndex(
        (candidate) => candidate.destinationPointTypeId === rule.destinationPointTypeId,
      ) !== index,
  );
  if (duplicateDestinations) throw new LoyaltyError("POINT_DUPLICATE_TRANSFER_TARGET", 400);
  return {
    ...input,
    // Give is the only transfer capability exposed by LoyaltyOS today. Keep
    // the legacy storage flag synchronized so it cannot contradict the UI.
    transferable: input.giveEnabled,
    maxRecipients: input.allowMultiRecipient ? input.maxRecipients : 1,
    expiryDays: input.expiryMode === "AFTER_DAYS" ? input.expiryDays : null,
    fixedExpiryAt:
      input.expiryMode === "FIXED_DATE" && input.fixedExpiryAt
        ? new Date(input.fixedExpiryAt)
        : null,
    expiryWarningDays: [...new Set(input.expiryWarningDays)].sort((a, b) => b - a),
  };
}

async function validateTransferTargets(
  tx: Prisma.TransactionClient,
  programId: string,
  transferRules: PointTypeInput["transferRules"],
) {
  if (transferRules.length === 0) return;
  const destinations = await tx.pointTypeDefinition.count({
    where: {
      programId,
      id: { in: transferRules.map((rule) => rule.destinationPointTypeId) },
      archivedAt: null,
    },
  });
  if (destinations !== transferRules.length)
    throw new LoyaltyError("POINT_TRANSFER_TARGET_NOT_FOUND", 404);
}

async function replaceTransferRules(
  tx: Prisma.TransactionClient,
  programId: string,
  sourcePointTypeId: string,
  transferRules: PointTypeInput["transferRules"],
) {
  const normalizedRules = transferRules.map((rule) => ({
    ...rule,
    destinationPointTypeId:
      rule.destinationPointTypeId === "SELF" ? sourcePointTypeId : rule.destinationPointTypeId,
  }));
  if (
    new Set(normalizedRules.map((rule) => rule.destinationPointTypeId)).size !==
    normalizedRules.length
  ) {
    throw new LoyaltyError("POINT_DUPLICATE_TRANSFER_TARGET", 400);
  }
  await validateTransferTargets(tx, programId, normalizedRules);
  await tx.pointTransferRule.deleteMany({ where: { sourcePointTypeId } });
  if (normalizedRules.length > 0) {
    await tx.pointTransferRule.createMany({
      data: normalizedRules.map((rule) => ({
        programId,
        sourcePointTypeId,
        destinationPointTypeId: rule.destinationPointTypeId,
        sourceAmount: rule.sourceAmount,
        destinationAmount: rule.destinationAmount,
        isActive: rule.isActive,
      })),
    });
  }
}

function idempotencyKey(request: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8)
    throw new LoyaltyError("MISSING_IDEMPOTENCY_KEY", 400);
  return key;
}

export function pointTypesRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get("/point-types", async (request, reply) => {
    const pointTypes = await walletService.pointTypes(request.programId);
    return reply.send({
      data: pointTypes.filter((pointType) => pointType.isActive),
    });
  });

  app.get("/members/me/point-wallets", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    return reply.send({
      data: await walletService.memberWallets(request.memberId, request.programId),
    });
  });

  app.get(
    "/admin/point-types/templates",
    { preHandler: [requireCapability("point_type.view")] },
    async (_request, reply) => {
      return reply.send({
        data: [
          {
            key: "credit-recognition",
            name: "Credit & Recognition (P/R)",
            description:
              "Creates configurable P and R point types with P→R and R→R transfer rules.",
          },
        ],
      });
    },
  );

  app.post(
    "/admin/point-types/templates/credit-recognition/apply",
    { preHandler: [requireCapability("point_type.manage")] },
    async (request, reply) => {
      const result = await walletService.applyCreditRecognitionTemplate(request.programId);
      await audit(
        request.programId,
        request.actor,
        "CONFIG_CHANGE",
        "point_type_template",
        "credit-recognition",
        { createdPointTypeIds: result.pointTypes.map((pointType) => pointType.id) },
      );
      return reply.status(201).send({ data: result });
    },
  );

  app.get(
    "/admin/point-types",
    { preHandler: [requireCapability("point_type.view")] },
    async (request, reply) => {
      return reply.send({ data: await walletService.pointTypes(request.programId, true) });
    },
  );

  app.post(
    "/admin/point-types",
    { preHandler: [requireCapability("point_type.manage")] },
    async (request, reply) => {
      const parsed = createPointTypeSchema.parse(request.body);
      const input = normalizePointType({
        ...pointTypeDefaults,
        ...parsed,
        transferRules: parsed.transferRules ?? pointTypeDefaults.transferRules,
        metadata: parsed.metadata ?? pointTypeDefaults.metadata,
      });
      const pointType = await prisma.$transaction(async (tx) => {
        const codeConflict = await tx.pointTypeDefinition.findFirst({
          where: { programId: request.programId, code: input.code },
          select: { id: true },
        });
        if (codeConflict) throw new LoyaltyError("POINT_TYPE_CODE_EXISTS", 409);
        const existingPrimary = await tx.pointTypeDefinition.findFirst({
          where: { programId: request.programId, isPrimary: true, archivedAt: null },
          select: { id: true },
        });
        const makePrimary = input.isPrimary || (!existingPrimary && input.isActive);
        if (makePrimary) {
          await tx.pointTypeDefinition.updateMany({
            where: { programId: request.programId, isPrimary: true },
            data: { isPrimary: false },
          });
        }
        const { transferRules, ...data } = input;
        const created = await tx.pointTypeDefinition.create({
          data: {
            ...data,
            isPrimary: makePrimary,
            programId: request.programId,
            metadata: data.metadata as Prisma.InputJsonValue,
          },
        });
        await replaceTransferRules(tx, request.programId, created.id, transferRules);
        return created;
      });
      await audit(
        request.programId,
        request.actor,
        "CONFIG_CHANGE",
        "point_type_definition",
        pointType.id,
        input,
      );
      return reply.status(201).send({ data: pointType });
    },
  );

  app.post(
    "/admin/point-types/:id/clone",
    { preHandler: [requireCapability("point_type.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = z
        .object({
          code: z
            .string()
            .regex(POINT_TYPE_CODES)
            .transform((value) => value.toUpperCase()),
          name: z.string().trim().min(1).max(120),
        })
        .parse(request.body);
      const source = await prisma.pointTypeDefinition.findFirst({
        where: { id, programId: request.programId },
        include: { outgoingTransferRules: true },
      });
      if (!source) throw new LoyaltyError("POINT_TYPE_NOT_FOUND", 404);
      const cloned = await prisma.$transaction(async (tx) => {
        const codeConflict = await tx.pointTypeDefinition.findFirst({
          where: { programId: request.programId, code: body.code },
          select: { id: true },
        });
        if (codeConflict) throw new LoyaltyError("POINT_TYPE_CODE_EXISTS", 409);
        const created = await tx.pointTypeDefinition.create({
          data: {
            programId: request.programId,
            code: body.code,
            name: body.name,
            unitLabel: source.unitLabel,
            description: source.description,
            icon: source.icon,
            color: source.color,
            expiryMode: source.expiryMode,
            expiryDays: source.expiryDays,
            fixedExpiryAt: source.fixedExpiryAt,
            expiryWarningDays: source.expiryWarningDays,
            allowNegativeBalance: source.allowNegativeBalance,
            allowManualAdjustment: source.allowManualAdjustment,
            transferable: source.transferable,
            redeemable: source.redeemable,
            exchangeable: source.exchangeable,
            cashEligible: source.cashEligible,
            bankEnabled: source.bankEnabled,
            giveEnabled: source.giveEnabled,
            giveSource: source.giveSource,
            allowanceAmount: source.allowanceAmount,
            allowanceCycleDays: source.allowanceCycleDays,
            allowanceCarryOver: source.allowanceCarryOver,
            pairLimit: source.pairLimit,
            pairLimitPeriodDays: source.pairLimitPeriodDays,
            requireGiveMessage: source.requireGiveMessage,
            allowMultiRecipient: source.allowMultiRecipient,
            maxRecipients: source.maxRecipients,
            showOnMemberProfile: source.showOnMemberProfile,
            showZeroBalance: source.showZeroBalance,
            sortOrder: source.sortOrder + 1,
            metadata: source.metadata ?? {},
          },
        });
        await replaceTransferRules(
          tx,
          request.programId,
          created.id,
          source.outgoingTransferRules.map((rule) => ({
            destinationPointTypeId:
              rule.destinationPointTypeId === source.id ? created.id : rule.destinationPointTypeId,
            sourceAmount: rule.sourceAmount,
            destinationAmount: rule.destinationAmount,
            isActive: rule.isActive,
          })),
        );
        return created;
      });
      await audit(
        request.programId,
        request.actor,
        "CONFIG_CHANGE",
        "point_type_definition",
        cloned.id,
        { clonedFrom: source.id, code: cloned.code, name: cloned.name },
      );
      return reply.status(201).send({ data: cloned });
    },
  );

  app.patch(
    "/admin/point-types/:id",
    { preHandler: [requireCapability("point_type.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const patch = patchPointTypeSchema.parse(request.body);
      const existing = await prisma.pointTypeDefinition.findFirst({
        where: { id, programId: request.programId },
        include: { outgoingTransferRules: true },
      });
      if (!existing) throw new LoyaltyError("POINT_TYPE_NOT_FOUND", 404);
      const merged = normalizePointType({
        code: patch.code ?? existing.code,
        name: patch.name ?? existing.name,
        unitLabel: patch.unitLabel ?? existing.unitLabel,
        description: patch.description === undefined ? existing.description : patch.description,
        icon: patch.icon === undefined ? existing.icon : patch.icon,
        color: patch.color === undefined ? existing.color : patch.color,
        expiryMode:
          patch.expiryMode ?? (existing.expiryMode as (typeof POINT_EXPIRY_MODES)[number]),
        expiryDays: patch.expiryDays === undefined ? existing.expiryDays : patch.expiryDays,
        fixedExpiryAt:
          patch.fixedExpiryAt === undefined
            ? (existing.fixedExpiryAt?.toISOString() ?? null)
            : patch.fixedExpiryAt,
        expiryWarningDays: patch.expiryWarningDays ?? existing.expiryWarningDays,
        allowNegativeBalance: patch.allowNegativeBalance ?? existing.allowNegativeBalance,
        allowManualAdjustment: patch.allowManualAdjustment ?? existing.allowManualAdjustment,
        transferable: patch.transferable ?? existing.transferable,
        redeemable: patch.redeemable ?? existing.redeemable,
        exchangeable: patch.exchangeable ?? existing.exchangeable,
        cashEligible: patch.cashEligible ?? existing.cashEligible,
        bankEnabled: patch.bankEnabled ?? existing.bankEnabled,
        giveEnabled: patch.giveEnabled ?? existing.giveEnabled,
        giveSource:
          patch.giveSource ?? (existing.giveSource as (typeof POINT_GIVE_SOURCES)[number]),
        allowanceAmount:
          patch.allowanceAmount === undefined ? existing.allowanceAmount : patch.allowanceAmount,
        allowanceCycleDays: patch.allowanceCycleDays ?? existing.allowanceCycleDays,
        allowanceCarryOver: patch.allowanceCarryOver ?? existing.allowanceCarryOver,
        pairLimit: patch.pairLimit === undefined ? existing.pairLimit : patch.pairLimit,
        pairLimitPeriodDays: patch.pairLimitPeriodDays ?? existing.pairLimitPeriodDays,
        requireGiveMessage: patch.requireGiveMessage ?? existing.requireGiveMessage,
        allowMultiRecipient: patch.allowMultiRecipient ?? existing.allowMultiRecipient,
        maxRecipients: patch.maxRecipients ?? existing.maxRecipients,
        showOnMemberProfile: patch.showOnMemberProfile ?? existing.showOnMemberProfile,
        showZeroBalance: patch.showZeroBalance ?? existing.showZeroBalance,
        isPrimary: patch.isPrimary ?? existing.isPrimary,
        sortOrder: patch.sortOrder ?? existing.sortOrder,
        isActive: patch.isActive ?? existing.isActive,
        metadata:
          patch.metadata ??
          (existing.metadata && typeof existing.metadata === "object"
            ? (existing.metadata as Record<string, unknown>)
            : {}),
        transferRules:
          patch.transferRules ??
          existing.outgoingTransferRules.map((rule) => ({
            destinationPointTypeId: rule.destinationPointTypeId,
            sourceAmount: rule.sourceAmount,
            destinationAmount: rule.destinationAmount,
            isActive: rule.isActive,
          })),
      });
      const pointType = await prisma.$transaction(async (tx) => {
        if (merged.code !== existing.code) {
          const codeConflict = await tx.pointTypeDefinition.findFirst({
            where: { programId: request.programId, code: merged.code, id: { not: id } },
            select: { id: true },
          });
          if (codeConflict) throw new LoyaltyError("POINT_TYPE_CODE_EXISTS", 409);
        }
        if (merged.isPrimary) {
          await tx.pointTypeDefinition.updateMany({
            where: { programId: request.programId, isPrimary: true, NOT: { id } },
            data: { isPrimary: false },
          });
        }
        const { transferRules, ...data } = merged;
        const updated = await tx.pointTypeDefinition.update({
          where: { id },
          data: { ...data, metadata: data.metadata as Prisma.InputJsonValue },
        });
        await replaceTransferRules(tx, request.programId, id, transferRules);
        if (!merged.isPrimary && existing.isPrimary) {
          const replacement = await tx.pointTypeDefinition.findFirst({
            where: {
              programId: request.programId,
              id: { not: id },
              isActive: true,
              archivedAt: null,
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: { id: true },
          });
          if (replacement) {
            await tx.pointTypeDefinition.update({
              where: { id: replacement.id },
              data: { isPrimary: true },
            });
          } else if (updated.isActive) {
            return tx.pointTypeDefinition.update({
              where: { id },
              data: { isPrimary: true },
            });
          }
        }
        return updated;
      });
      await audit(
        request.programId,
        request.actor,
        "CONFIG_CHANGE",
        "point_type_definition",
        pointType.id,
        merged,
      );
      return reply.send({ data: pointType });
    },
  );

  app.delete(
    "/admin/point-types/:id",
    { preHandler: [requireCapability("point_type.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const result = await walletService.removePointType(request.programId, id);
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "point_type_definition", id, {
        removalMode: result.mode,
      });
      return reply.send({ data: result });
    },
  );

  app.post(
    "/admin/point-types/:id/restore",
    { preHandler: [requireCapability("point_type.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const pointType = await prisma.pointTypeDefinition.findFirst({
        where: { id, programId: request.programId },
      });
      if (!pointType) throw new LoyaltyError("POINT_TYPE_NOT_FOUND", 404);
      const restored = await prisma.$transaction(async (tx) => {
        const primary = await tx.pointTypeDefinition.findFirst({
          where: { programId: request.programId, isPrimary: true, archivedAt: null },
          select: { id: true },
        });
        return tx.pointTypeDefinition.update({
          where: { id },
          data: { archivedAt: null, isActive: true, isPrimary: !primary },
        });
      });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "point_type_definition", id, {
        restored: true,
        isPrimary: restored.isPrimary,
      });
      return reply.send({ data: restored });
    },
  );

  app.post(
    "/admin/point-types/:id/adjust",
    { preHandler: [requireCapability("wallet.adjust")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = z
        .object({
          memberId: z.string().min(1),
          amount: z
            .number()
            .int()
            .refine((value) => value !== 0),
          reason: z.string().trim().min(1).max(500),
          expiresAt: z.string().datetime().optional(),
        })
        .parse(request.body);
      const transaction = await walletService.adjust(
        request.programId,
        body.memberId,
        { pointTypeId: id },
        body.amount,
        body.reason,
        request.actor,
        idempotencyKey(request),
        body.expiresAt ? new Date(body.expiresAt) : undefined,
      );
      await audit(
        request.programId,
        request.actor,
        "CREDIT_ADJUSTMENT",
        "point_wallet",
        transaction.id,
        { pointTypeId: id, ...body },
        body.reason,
      );
      return reply.status(201).send({ data: transaction });
    },
  );

  done();
}
