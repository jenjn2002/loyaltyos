import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../db.js";
import { LoyaltyError } from "./errors.js";

export const BUILTIN_POINT_TYPES = [
  {
    code: "P",
    name: "P-credit",
    unitLabel: "P-credit",
    description: "Project credit with expiry and cash exchange support.",
    expiryMode: "AFTER_DAYS",
    expiryDays: 365,
    transferable: false,
    redeemable: true,
    exchangeable: true,
    cashEligible: true,
  },
  {
    code: "R",
    name: "R-credit",
    unitLabel: "R-credit",
    description: "Recognition credit with no expiry and no cash exchange.",
    expiryMode: "NEVER",
    expiryDays: null,
    transferable: true,
    redeemable: true,
    exchangeable: true,
    cashEligible: false,
  },
] as const;

export const POINT_TYPE_CODES = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
export const POINT_TYPE_EXPIRY_MODES = ["NEVER", "AFTER_DAYS"] as const;

export function isBuiltInCreditType(code: string): boolean {
  return code === "P" || code === "R";
}

export async function ensureBuiltInPointTypes(
  programId: string,
  db: PrismaClient = prisma,
): Promise<void> {
  await Promise.all(
    BUILTIN_POINT_TYPES.map((definition) =>
      db.pointTypeDefinition.upsert({
        where: { programId_code: { programId, code: definition.code } },
        create: { programId, ...definition },
        update: {},
      }),
    ),
  );
}

export async function listPointTypes(
  programId: string,
  includeInactive = true,
  db: PrismaClient = prisma,
) {
  await ensureBuiltInPointTypes(programId, db);
  return db.pointTypeDefinition.findMany({
    where: { programId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
  });
}

export async function listCustomPointTypes(
  programId: string,
  includeInactive = false,
  db: PrismaClient = prisma,
) {
  const definitions = await listPointTypes(programId, includeInactive, db);
  return definitions.filter((definition) => !isBuiltInCreditType(definition.code));
}

export async function memberPointWallets(
  memberId: string,
  programId: string,
  db: PrismaClient = prisma,
) {
  await ensureBuiltInPointTypes(programId, db);
  const [definitions, wallets] = await Promise.all([
    db.pointTypeDefinition.findMany({
      where: { programId, isActive: true, NOT: [{ code: "P" }, { code: "R" }] },
      orderBy: [{ createdAt: "asc" }],
    }),
    db.customPointWallet.findMany({ where: { memberId, programId }, include: { pointType: true } }),
  ]);
  const walletByType = new Map(wallets.map((wallet) => [wallet.pointTypeId, wallet]));
  return definitions.map((definition) => {
    const wallet = walletByType.get(definition.id);
    return {
      pointTypeId: definition.id,
      code: definition.code,
      name: definition.name,
      unitLabel: definition.unitLabel,
      description: definition.description,
      color: definition.color,
      expiryMode: definition.expiryMode,
      expiryDays: definition.expiryDays,
      transferable: definition.transferable,
      redeemable: definition.redeemable,
      exchangeable: definition.exchangeable,
      cashEligible: definition.cashEligible,
      balance: wallet?.balance ?? 0,
      totalEarned: wallet?.totalEarned ?? 0,
      totalSpent: wallet?.totalSpent ?? 0,
    };
  });
}

interface AdjustPointInput {
  programId: string;
  memberId: string;
  pointTypeId: string;
  amount: number;
  reason: string;
  actorId: string;
  actorType: string;
  idempotencyKey: string;
  expiresAt?: Date;
}

export async function adjustPointWallet(input: AdjustPointInput, db: PrismaClient = prisma) {
  if (!Number.isInteger(input.amount) || input.amount === 0)
    throw new LoyaltyError("POINT_AMOUNT_INVALID", 400);
  if (!input.reason.trim()) throw new LoyaltyError("POINT_REASON_REQUIRED", 400);

  return db.$transaction(async (tx) => {
    const existing = await tx.customPointTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing;

    const [definition, member] = await Promise.all([
      tx.pointTypeDefinition.findFirst({
        where: { id: input.pointTypeId, programId: input.programId, isActive: true },
      }),
      tx.member.findFirst({
        where: {
          id: input.memberId,
          programId: input.programId,
          deletedAt: null,
          status: "ACTIVE",
        },
      }),
    ]);
    if (!definition) throw new LoyaltyError("POINT_TYPE_NOT_FOUND", 404);
    if (isBuiltInCreditType(definition.code)) {
      throw new LoyaltyError("POINT_TYPE_USE_CREDITS_MODULE", 409);
    }
    if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
    if (!definition.allowManualAdjustment)
      throw new LoyaltyError("POINT_MANUAL_ADJUSTMENT_DISABLED", 409);
    if (input.amount < 0 && !definition.allowNegativeBalance) {
      const wallet = await tx.customPointWallet.findUnique({
        where: { memberId_pointTypeId: { memberId: input.memberId, pointTypeId: definition.id } },
      });
      if ((wallet?.balance ?? 0) < Math.abs(input.amount))
        throw new LoyaltyError("POINT_INSUFFICIENT_BALANCE", 422);
    }

    const wallet = await tx.customPointWallet.upsert({
      where: { memberId_pointTypeId: { memberId: input.memberId, pointTypeId: definition.id } },
      create: { memberId: input.memberId, programId: input.programId, pointTypeId: definition.id },
      update: {},
    });
    const balanceAfter = wallet.balance + input.amount;
    if (balanceAfter < 0 && !definition.allowNegativeBalance)
      throw new LoyaltyError("POINT_INSUFFICIENT_BALANCE", 422);

    const expiresAt =
      input.amount > 0
        ? (input.expiresAt ??
          (definition.expiryMode === "AFTER_DAYS" && definition.expiryDays
            ? new Date(Date.now() + definition.expiryDays * 86_400_000)
            : null))
        : null;
    const transaction = await tx.customPointTransaction.create({
      data: {
        walletId: wallet.id,
        memberId: input.memberId,
        programId: input.programId,
        pointTypeId: definition.id,
        action: input.amount > 0 ? "GRANT" : "ADJUSTMENT",
        amount: input.amount,
        balanceAfter,
        reason: input.reason.trim(),
        actorType: input.actorType,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        expiresAt,
      },
    });

    await tx.customPointWallet.update({
      where: { id: wallet.id },
      data: {
        balance: balanceAfter,
        ...(input.amount > 0
          ? { totalEarned: { increment: input.amount } }
          : { totalSpent: { increment: Math.abs(input.amount) } }),
      },
    });

    if (input.amount > 0) {
      await tx.customPointLot.create({
        data: {
          walletId: wallet.id,
          memberId: input.memberId,
          programId: input.programId,
          pointTypeId: definition.id,
          grantTransactionId: transaction.id,
          originalAmount: input.amount,
          remainingAmount: input.amount,
          expiresAt,
        },
      });
    } else {
      let remaining = Math.abs(input.amount);
      const lots = await tx.customPointLot.findMany({
        where: { walletId: wallet.id, remainingAmount: { gt: 0 } },
        orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
      });
      for (const lot of lots) {
        if (remaining <= 0) break;
        const consumed = Math.min(remaining, lot.remainingAmount);
        await tx.customPointLot.update({
          where: { id: lot.id },
          data: { remainingAmount: { decrement: consumed } },
        });
        remaining -= consumed;
      }
    }

    return transaction;
  });
}

export async function expirePointLots(programId: string, db: PrismaClient = prisma): Promise<void> {
  const lots = await db.customPointLot.findMany({
    where: { programId, expiresAt: { lte: new Date() }, remainingAmount: { gt: 0 } },
    take: 500,
  });
  for (const lot of lots) {
    await db.$transaction(async (tx) => {
      const current = await tx.customPointLot.findUnique({ where: { id: lot.id } });
      if (!current || current.remainingAmount <= 0) return;
      const wallet = await tx.customPointWallet.findUnique({ where: { id: current.walletId } });
      if (!wallet) return;
      const amount = current.remainingAmount;
      const balanceAfter = wallet.balance - amount;
      await tx.customPointLot.update({ where: { id: current.id }, data: { remainingAmount: 0 } });
      await tx.customPointWallet.update({
        where: { id: wallet.id },
        data: { balance: balanceAfter, totalSpent: { increment: amount } },
      });
      await tx.customPointTransaction.create({
        data: {
          walletId: wallet.id,
          memberId: current.memberId,
          programId,
          pointTypeId: current.pointTypeId,
          action: "EXPIRE",
          amount: -amount,
          balanceAfter,
          reason: "Point lot expired",
          actorType: "SYSTEM",
          idempotencyKey: `custom-point-expire:${current.id}`,
          expiresAt: current.expiresAt,
        },
      });
    });
  }
}

export function pointTypeMetadata(metadata: unknown): Prisma.InputJsonValue | undefined {
  return metadata as Prisma.InputJsonValue | undefined;
}
