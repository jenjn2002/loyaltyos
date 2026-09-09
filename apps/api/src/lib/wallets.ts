import { createHash, randomUUID } from "node:crypto";

import type {
  CustomPointTransaction,
  PointExchangeStatus,
  PointTypeDefinition,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { prisma } from "../db.js";
import { LoyaltyError } from "./errors.js";

export const POINT_TYPE_CODES = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
export const POINT_EXPIRY_MODES = ["NEVER", "AFTER_DAYS", "FIXED_DATE", "PER_GRANT"] as const;
export const POINT_GIVE_SOURCES = ["BALANCE", "ALLOWANCE", "BOTH"] as const;

export interface PointTypeSelector {
  pointTypeId?: string;
  pointTypeCode?: string;
}

export interface LedgerActor {
  type: string;
  id: string;
}

type Tx = Prisma.TransactionClient;

const DAY_MS = 86_400_000;

function exchangeDocumentNumber(now = new Date()): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const token = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  return `EXC-${date}-${token}`;
}

function json(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  return value as Prisma.InputJsonValue | undefined;
}

function assertPositiveInteger(value: number, code = "POINT_AMOUNT_INVALID"): void {
  if (!Number.isInteger(value) || value <= 0) throw new LoyaltyError(code, 400);
}

function pointTypeWhere(programId: string, selector: PointTypeSelector) {
  if (selector.pointTypeId) return { id: selector.pointTypeId, programId };
  if (selector.pointTypeCode) return { code: selector.pointTypeCode.toUpperCase(), programId };
  throw new LoyaltyError("POINT_TYPE_REQUIRED", 400);
}

async function resolvePointType(
  db: Tx | PrismaClient,
  programId: string,
  selector: PointTypeSelector,
  activeOnly = true,
) {
  const pointType = await db.pointTypeDefinition.findFirst({
    where: {
      ...pointTypeWhere(programId, selector),
      ...(activeOnly ? { isActive: true, archivedAt: null } : {}),
    },
  });
  if (!pointType) throw new LoyaltyError("POINT_TYPE_NOT_FOUND", 404);
  return pointType;
}

function expiryFor(
  pointType: Pick<PointTypeDefinition, "expiryMode" | "expiryDays" | "fixedExpiryAt">,
  explicitExpiry?: Date,
  now = new Date(),
): Date | null {
  if (pointType.expiryMode === "NEVER") return null;
  if (pointType.expiryMode === "AFTER_DAYS") {
    if (!pointType.expiryDays) throw new LoyaltyError("POINT_EXPIRY_DAYS_REQUIRED", 409);
    return new Date(now.getTime() + pointType.expiryDays * DAY_MS);
  }
  if (pointType.expiryMode === "FIXED_DATE") {
    if (!pointType.fixedExpiryAt) throw new LoyaltyError("POINT_FIXED_EXPIRY_REQUIRED", 409);
    if (pointType.fixedExpiryAt <= now) throw new LoyaltyError("POINT_EXPIRY_IN_PAST", 409);
    return pointType.fixedExpiryAt;
  }
  if (!explicitExpiry) throw new LoyaltyError("POINT_GRANT_EXPIRY_REQUIRED", 400);
  if (explicitExpiry <= now) throw new LoyaltyError("POINT_EXPIRY_IN_PAST", 400);
  return explicitExpiry;
}

async function ensureWallet(tx: Tx, memberId: string, programId: string, pointTypeId: string) {
  return tx.customPointWallet.upsert({
    where: { memberId_pointTypeId: { memberId, pointTypeId } },
    create: { memberId, programId, pointTypeId },
    update: {},
  });
}

async function latestHash(tx: Tx, programId: string): Promise<string | null> {
  const previous = await tx.customPointTransaction.findFirst({
    where: { programId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { recordHash: true },
  });
  return previous?.recordHash ?? null;
}

async function lockLedger(tx: Tx, programId: string): Promise<void> {
  // Serialize the hash chain per program. Without this lock, two concurrent
  // transactions can legitimately read the same previous hash and fork the
  // otherwise append-only chain.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${programId}))`;
}

function ledgerHash(input: {
  programId: string;
  memberId: string;
  pointTypeId: string;
  action: string;
  amount: number;
  balanceAfter: number;
  source: string;
  idempotencyKey: string;
  previousHash: string | null;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

interface LedgerCommon {
  memberId: string;
  programId: string;
  pointType: PointTypeDefinition;
  action: string;
  source: string;
  idempotencyKey: string;
  reason?: string;
  message?: string;
  category?: string;
  categoryId?: string;
  counterpartyMemberId?: string;
  sourcePointTypeId?: string;
  destinationPointTypeId?: string;
  exchangeRateId?: string;
  exchangeRequestId?: string;
  actor?: LedgerActor;
  metadata?: Record<string, unknown>;
}

interface CreditLedgerInput extends LedgerCommon {
  amount: number;
  explicitExpiry?: Date;
  restoredLots?: { amount: number; expiresAt: Date | null }[];
}

interface DebitLedgerInput extends LedgerCommon {
  amount: number;
}

interface DebitResult {
  transaction: CustomPointTransaction & { balanceBefore: number };
  consumedLots: { lotId: string; amount: number; expiresAt: Date | null }[];
  idempotent: boolean;
}

function assertSameLedgerRequest(
  existing: CustomPointTransaction,
  input: LedgerCommon,
  signedAmount: number,
): void {
  if (
    existing.memberId !== input.memberId ||
    existing.pointTypeId !== input.pointType.id ||
    existing.action !== input.action ||
    existing.amount !== signedAmount ||
    existing.source !== input.source
  ) {
    throw new LoyaltyError("POINT_IDEMPOTENCY_CONFLICT", 409);
  }
}

async function creditWallet(tx: Tx, input: CreditLedgerInput) {
  const existing = await tx.customPointTransaction.findUnique({
    where: {
      programId_idempotencyKey: {
        programId: input.programId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) {
    assertSameLedgerRequest(existing, input, input.amount);
    return {
      ...existing,
      balanceBefore: existing.balanceAfter - existing.amount,
      idempotent: true,
    };
  }

  assertPositiveInteger(input.amount);
  const calculatedExpiry =
    input.restoredLots === undefined ? expiryFor(input.pointType, input.explicitExpiry) : undefined;
  if (
    input.restoredLots &&
    input.restoredLots.reduce((sum, lot) => sum + lot.amount, 0) !== input.amount
  ) {
    throw new LoyaltyError("POINT_RESTORED_LOTS_INVALID", 409);
  }
  const wallet = await ensureWallet(tx, input.memberId, input.programId, input.pointType.id);
  const updated = await tx.customPointWallet.update({
    where: { id: wallet.id },
    data: {
      balance: { increment: input.amount },
      totalEarned: { increment: input.amount },
    },
  });
  await lockLedger(tx, input.programId);
  const previousHash = await latestHash(tx, input.programId);
  const recordHash = ledgerHash({
    programId: input.programId,
    memberId: input.memberId,
    pointTypeId: input.pointType.id,
    action: input.action,
    amount: input.amount,
    balanceAfter: updated.balance,
    source: input.source,
    idempotencyKey: input.idempotencyKey,
    previousHash,
  });
  const transaction = await tx.customPointTransaction.create({
    data: {
      walletId: wallet.id,
      memberId: input.memberId,
      programId: input.programId,
      pointTypeId: input.pointType.id,
      action: input.action,
      amount: input.amount,
      balanceAfter: updated.balance,
      source: input.source,
      reason: input.reason,
      message: input.message,
      category: input.category,
      categoryId: input.categoryId,
      counterpartyMemberId: input.counterpartyMemberId,
      sourcePointTypeId: input.sourcePointTypeId,
      destinationPointTypeId: input.destinationPointTypeId,
      exchangeRateId: input.exchangeRateId,
      exchangeRequestId: input.exchangeRequestId,
      actorType: input.actor?.type,
      actorId: input.actor?.id,
      previousHash,
      recordHash,
      idempotencyKey: input.idempotencyKey,
      expiresAt: calculatedExpiry,
      metadata: json(input.metadata),
    },
  });

  const lots = input.restoredLots ?? [
    {
      amount: input.amount,
      expiresAt: calculatedExpiry ?? null,
    },
  ];
  for (const lot of lots) {
    if (lot.amount <= 0) continue;
    await tx.customPointLot.create({
      data: {
        walletId: wallet.id,
        memberId: input.memberId,
        programId: input.programId,
        pointTypeId: input.pointType.id,
        grantTransactionId: transaction.id,
        originalAmount: lot.amount,
        remainingAmount: lot.amount,
        expiresAt: lot.expiresAt,
      },
    });
  }
  return { ...transaction, balanceBefore: wallet.balance, idempotent: false };
}

async function debitWallet(tx: Tx, input: DebitLedgerInput): Promise<DebitResult> {
  const existing = await tx.customPointTransaction.findUnique({
    where: {
      programId_idempotencyKey: {
        programId: input.programId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) {
    assertSameLedgerRequest(existing, input, -input.amount);
    return {
      transaction: {
        ...existing,
        balanceBefore: existing.balanceAfter + Math.abs(existing.amount),
      },
      consumedLots: [],
      idempotent: true,
    };
  }

  assertPositiveInteger(input.amount);
  const wallet = await ensureWallet(tx, input.memberId, input.programId, input.pointType.id);

  if (input.pointType.allowNegativeBalance) {
    await tx.customPointWallet.update({
      where: { id: wallet.id },
      data: {
        balance: { decrement: input.amount },
        totalSpent: { increment: input.amount },
      },
    });
  } else {
    const updated = await tx.customPointWallet.updateMany({
      where: { id: wallet.id, balance: { gte: input.amount } },
      data: {
        balance: { decrement: input.amount },
        totalSpent: { increment: input.amount },
      },
    });
    if (updated.count !== 1) throw new LoyaltyError("POINT_INSUFFICIENT_BALANCE", 422);
  }

  let remaining = input.amount;
  const consumedLots: DebitResult["consumedLots"] = [];
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
    consumedLots.push({ lotId: lot.id, amount: consumed, expiresAt: lot.expiresAt });
    remaining -= consumed;
  }

  const updated = await tx.customPointWallet.findUniqueOrThrow({ where: { id: wallet.id } });
  await lockLedger(tx, input.programId);
  const previousHash = await latestHash(tx, input.programId);
  const signedAmount = -input.amount;
  const metadata = {
    ...input.metadata,
    ...(consumedLots.length > 0
      ? {
          consumedLots: consumedLots.map((lot) => ({
            lotId: lot.lotId,
            amount: lot.amount,
            expiresAt: lot.expiresAt?.toISOString() ?? null,
          })),
        }
      : {}),
  };
  const recordHash = ledgerHash({
    programId: input.programId,
    memberId: input.memberId,
    pointTypeId: input.pointType.id,
    action: input.action,
    amount: signedAmount,
    balanceAfter: updated.balance,
    source: input.source,
    idempotencyKey: input.idempotencyKey,
    previousHash,
  });
  const transaction = await tx.customPointTransaction.create({
    data: {
      walletId: wallet.id,
      memberId: input.memberId,
      programId: input.programId,
      pointTypeId: input.pointType.id,
      action: input.action,
      amount: signedAmount,
      balanceAfter: updated.balance,
      source: input.source,
      reason: input.reason,
      message: input.message,
      category: input.category,
      categoryId: input.categoryId,
      counterpartyMemberId: input.counterpartyMemberId,
      sourcePointTypeId: input.sourcePointTypeId,
      destinationPointTypeId: input.destinationPointTypeId,
      exchangeRateId: input.exchangeRateId,
      exchangeRequestId: input.exchangeRequestId,
      actorType: input.actor?.type,
      actorId: input.actor?.id,
      previousHash,
      recordHash,
      idempotencyKey: input.idempotencyKey,
      metadata: json(metadata),
    },
  });
  return {
    transaction: { ...transaction, balanceBefore: wallet.balance },
    consumedLots,
    idempotent: false,
  };
}

async function neutralAllowanceEntry(tx: Tx, input: LedgerCommon & { allowanceSpent: number }) {
  const existing = await tx.customPointTransaction.findUnique({
    where: {
      programId_idempotencyKey: {
        programId: input.programId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) {
    assertSameLedgerRequest(existing, input, 0);
    return existing;
  }
  const wallet = await ensureWallet(tx, input.memberId, input.programId, input.pointType.id);
  await lockLedger(tx, input.programId);
  const previousHash = await latestHash(tx, input.programId);
  const recordHash = ledgerHash({
    programId: input.programId,
    memberId: input.memberId,
    pointTypeId: input.pointType.id,
    action: input.action,
    amount: 0,
    balanceAfter: wallet.balance,
    source: input.source,
    idempotencyKey: input.idempotencyKey,
    previousHash,
  });
  return tx.customPointTransaction.create({
    data: {
      walletId: wallet.id,
      memberId: input.memberId,
      programId: input.programId,
      pointTypeId: input.pointType.id,
      action: input.action,
      amount: 0,
      balanceAfter: wallet.balance,
      source: input.source,
      reason: input.reason,
      message: input.message,
      category: input.category,
      categoryId: input.categoryId,
      counterpartyMemberId: input.counterpartyMemberId,
      sourcePointTypeId: input.sourcePointTypeId,
      destinationPointTypeId: input.destinationPointTypeId,
      actorType: input.actor?.type,
      actorId: input.actor?.id,
      previousHash,
      recordHash,
      idempotencyKey: input.idempotencyKey,
      metadata: json({ ...input.metadata, allowanceSpent: input.allowanceSpent }),
    },
  });
}

async function activeAllowance(tx: Tx, memberId: string, pointType: PointTypeDefinition) {
  const now = new Date();
  const current = await tx.pointAllowance.findFirst({
    where: {
      memberId,
      pointTypeId: pointType.id,
      cycleStart: { lte: now },
      cycleEnd: { gt: now },
    },
    orderBy: { cycleStart: "desc" },
  });
  if (current) return current;
  const base = pointType.allowanceAmount;
  if (base == null) throw new LoyaltyError("POINT_ALLOWANCE_NOT_CONFIGURED", 409);
  const previous = pointType.allowanceCarryOver
    ? await tx.pointAllowance.findFirst({
        where: { memberId, pointTypeId: pointType.id },
        orderBy: { cycleEnd: "desc" },
      })
    : null;
  const allocated = base + (previous?.remaining ?? 0);
  return tx.pointAllowance.create({
    data: {
      memberId,
      programId: pointType.programId,
      pointTypeId: pointType.id,
      cycleStart: now,
      cycleEnd: new Date(now.getTime() + pointType.allowanceCycleDays * DAY_MS),
      allocated,
      remaining: allocated,
    },
  });
}

async function ensureBank(tx: Tx, programId: string, pointTypeId: string) {
  return tx.pointBank.upsert({
    where: { programId_pointTypeId: { programId, pointTypeId } },
    create: { programId, pointTypeId },
    update: {},
  });
}

async function debitBank(
  tx: Tx,
  input: {
    programId: string;
    pointTypeId: string;
    amount: number;
    type: string;
    reason: string;
    actorId: string;
    idempotencyKey: string;
    cycleId?: string;
  },
) {
  const existing = await tx.pointBankTransaction.findUnique({
    where: {
      programId_idempotencyKey: {
        programId: input.programId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) {
    if (
      existing.pointTypeId !== input.pointTypeId ||
      existing.amount !== -input.amount ||
      existing.type !== input.type
    )
      throw new LoyaltyError("POINT_IDEMPOTENCY_CONFLICT", 409);
    return existing;
  }
  const bank = await ensureBank(tx, input.programId, input.pointTypeId);
  const changed = await tx.pointBank.updateMany({
    where: { id: bank.id, balance: { gte: input.amount } },
    data: { balance: { decrement: input.amount } },
  });
  if (changed.count !== 1) throw new LoyaltyError("POINT_BANK_INSUFFICIENT", 422);
  const updated = await tx.pointBank.findUniqueOrThrow({ where: { id: bank.id } });
  const activeCycle = input.cycleId
    ? null
    : await tx.pointBankCycle.findFirst({
        where: {
          programId: input.programId,
          pointTypeId: input.pointTypeId,
          status: "OPEN",
          startsAt: { lte: new Date() },
          endsAt: { gte: new Date() },
        },
        orderBy: { startsAt: "desc" },
        select: { id: true },
      });
  return tx.pointBankTransaction.create({
    data: {
      bankId: bank.id,
      programId: input.programId,
      pointTypeId: input.pointTypeId,
      amount: -input.amount,
      balanceAfter: updated.balance,
      type: input.type,
      reason: input.reason,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      cycleId: input.cycleId ?? activeCycle?.id,
    },
  });
}

async function creditBank(
  tx: Tx,
  input: {
    programId: string;
    pointTypeId: string;
    amount: number;
    type: string;
    reason: string;
    actorId: string;
    idempotencyKey: string;
    cycleId?: string;
  },
) {
  const existing = await tx.pointBankTransaction.findUnique({
    where: {
      programId_idempotencyKey: {
        programId: input.programId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) {
    if (
      existing.pointTypeId !== input.pointTypeId ||
      existing.amount !== input.amount ||
      existing.type !== input.type
    )
      throw new LoyaltyError("POINT_IDEMPOTENCY_CONFLICT", 409);
    return existing;
  }
  const bank = await ensureBank(tx, input.programId, input.pointTypeId);
  const updated = await tx.pointBank.update({
    where: { id: bank.id },
    data: { balance: { increment: input.amount } },
  });
  return tx.pointBankTransaction.create({
    data: {
      bankId: bank.id,
      programId: input.programId,
      pointTypeId: input.pointTypeId,
      amount: input.amount,
      balanceAfter: updated.balance,
      type: input.type,
      reason: input.reason,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      cycleId: input.cycleId,
    },
  });
}

export const CREDIT_RECOGNITION_TEMPLATE = {
  key: "credit-recognition",
  name: "Credit & Recognition (P/R)",
  description:
    "P-credit with per-grant expiry and P→R Give; R-credit with renewable Give allowance.",
} as const;

export class WalletService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async earn(input: {
    memberId: string;
    programId: string;
    amount: number;
    source: string;
    idempotencyKey: string;
    pointTypeId?: string;
    metadata?: Record<string, unknown>;
    expiresAt?: Date;
  }) {
    assertPositiveInteger(input.amount);
    return this.db.$transaction(async (tx) => {
      const member = await tx.member.findFirst({
        where: {
          id: input.memberId,
          programId: input.programId,
          deletedAt: null,
          status: "ACTIVE",
        },
      });
      if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
      const pointType = input.pointTypeId
        ? await resolvePointType(tx, input.programId, {
            pointTypeId: input.pointTypeId,
          })
        : await tx.pointTypeDefinition.findFirst({
            where: {
              programId: input.programId,
              isPrimary: true,
              isActive: true,
              archivedAt: null,
            },
          });
      if (!pointType) throw new LoyaltyError("PRIMARY_POINT_TYPE_NOT_CONFIGURED", 409);
      const transaction = await creditWallet(tx, {
        memberId: input.memberId,
        programId: input.programId,
        pointType,
        amount: input.amount,
        action: "EARN",
        source: input.source,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
        explicitExpiry: input.expiresAt,
        actor: { type: "SYSTEM", id: input.source },
      });
      return {
        transactionId: transaction.id,
        amount: transaction.amount,
        multiplier: 1,
        balanceAfter: transaction.balanceAfter,
        idempotent: transaction.idempotent,
      };
    });
  }

  async redeem(input: {
    memberId: string;
    programId: string;
    amount: number;
    source: string;
    idempotencyKey: string;
    pointTypeId?: string;
    metadata?: Record<string, unknown>;
  }) {
    assertPositiveInteger(input.amount);
    return this.db.$transaction(async (tx) => {
      const [member, pointType] = await Promise.all([
        tx.member.findFirst({
          where: {
            id: input.memberId,
            programId: input.programId,
            deletedAt: null,
            status: "ACTIVE",
          },
        }),
        input.pointTypeId
          ? resolvePointType(tx, input.programId, { pointTypeId: input.pointTypeId })
          : tx.pointTypeDefinition.findFirst({
              where: {
                programId: input.programId,
                isPrimary: true,
                isActive: true,
                archivedAt: null,
              },
            }),
      ]);
      if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
      if (!pointType) throw new LoyaltyError("PRIMARY_POINT_TYPE_NOT_CONFIGURED", 409);
      if (!pointType.redeemable) throw new LoyaltyError("POINT_REDEMPTION_DISABLED", 409);
      const result = await debitWallet(tx, {
        memberId: input.memberId,
        programId: input.programId,
        pointType,
        amount: input.amount,
        action: "REDEEM",
        source: input.source,
        actor: { type: "SYSTEM", id: input.source },
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      });
      return {
        transactionId: result.transaction.id,
        amount: result.transaction.amount,
        balanceAfter: result.transaction.balanceAfter,
        idempotent: result.idempotent,
      };
    });
  }

  async pointTypes(programId: string, includeArchived = false) {
    return this.db.pointTypeDefinition.findMany({
      where: { programId, ...(includeArchived ? {} : { archivedAt: null }) },
      include: {
        outgoingTransferRules: {
          orderBy: { createdAt: "asc" },
          include: {
            destinationType: {
              select: { id: true, code: true, name: true, isActive: true, archivedAt: true },
            },
          },
        },
      },
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  async memberWallets(memberId: string, programId: string, adminView = false) {
    const [types, wallets, allowances] = await Promise.all([
      this.db.pointTypeDefinition.findMany({
        where: {
          programId,
          isActive: true,
          archivedAt: null,
          ...(adminView ? {} : { showOnMemberProfile: true }),
        },
        include: {
          outgoingTransferRules: {
            where: {
              isActive: true,
              destinationType: { isActive: true, archivedAt: null },
            },
            include: {
              destinationType: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  unitLabel: true,
                  color: true,
                },
              },
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      this.db.customPointWallet.findMany({ where: { memberId, programId } }),
      this.db.pointAllowance.findMany({
        where: { memberId, programId, cycleEnd: { gt: new Date() } },
        orderBy: { cycleStart: "desc" },
      }),
    ]);
    const walletByType = new Map(wallets.map((wallet) => [wallet.pointTypeId, wallet]));
    const allowanceByType = new Map<string, (typeof allowances)[number]>();
    for (const allowance of allowances) {
      if (!allowanceByType.has(allowance.pointTypeId))
        allowanceByType.set(allowance.pointTypeId, allowance);
    }
    return types
      .map((pointType) => {
        const wallet = walletByType.get(pointType.id);
        const allowance = allowanceByType.get(pointType.id);
        return {
          pointTypeId: pointType.id,
          code: pointType.code,
          name: pointType.name,
          unitLabel: pointType.unitLabel,
          description: pointType.description,
          icon: pointType.icon,
          color: pointType.color,
          expiryMode: pointType.expiryMode,
          expiryDays: pointType.expiryDays,
          fixedExpiryAt: pointType.fixedExpiryAt,
          expiryWarningDays: pointType.expiryWarningDays,
          allowManualAdjustment: pointType.allowManualAdjustment,
          transferable: pointType.transferable,
          redeemable: pointType.redeemable,
          exchangeable: pointType.exchangeable,
          cashEligible: pointType.cashEligible,
          bankEnabled: pointType.bankEnabled,
          giveEnabled: pointType.giveEnabled,
          giveSource: pointType.giveSource,
          requireGiveMessage: pointType.requireGiveMessage,
          allowMultiRecipient: pointType.allowMultiRecipient,
          maxRecipients: pointType.maxRecipients,
          pairLimit: pointType.pairLimit,
          pairLimitPeriodDays: pointType.pairLimitPeriodDays,
          balance: wallet?.balance ?? 0,
          totalEarned: wallet?.totalEarned ?? 0,
          totalSpent: wallet?.totalSpent ?? 0,
          allowance:
            pointType.giveEnabled &&
            (pointType.giveSource === "ALLOWANCE" || pointType.giveSource === "BOTH")
              ? {
                  allocated: allowance?.allocated ?? pointType.allowanceAmount ?? 0,
                  remaining: allowance?.remaining ?? pointType.allowanceAmount ?? 0,
                  cycleStart: allowance?.cycleStart ?? null,
                  cycleEnd: allowance?.cycleEnd ?? null,
                  cycleDays: pointType.allowanceCycleDays,
                }
              : null,
          transferTargets: pointType.outgoingTransferRules.map((rule) => ({
            ...rule.destinationType,
            sourceAmount: rule.sourceAmount,
            destinationAmount: rule.destinationAmount,
          })),
          showZeroBalance: pointType.showZeroBalance,
          isPrimary: pointType.isPrimary,
        };
      })
      .filter((wallet) => adminView || wallet.showZeroBalance || wallet.balance !== 0);
  }

  async applyCreditRecognitionTemplate(programId: string) {
    return this.db.$transaction(async (tx) => {
      const [conflicts, existingPrimary] = await Promise.all([
        tx.pointTypeDefinition.findMany({
          where: { programId, code: { in: ["P", "R"] } },
          select: { code: true },
        }),
        tx.pointTypeDefinition.findFirst({
          where: { programId, isPrimary: true, archivedAt: null },
          select: { id: true },
        }),
      ]);
      if (conflicts.length > 0) throw new LoyaltyError("POINT_TEMPLATE_CODE_CONFLICT", 409);
      const p = await tx.pointTypeDefinition.create({
        data: {
          programId,
          code: "P",
          name: "P-credit",
          unitLabel: "P-credit",
          description:
            "Project credit. It can expire and may be exchanged for cash when a cash rate is configured.",
          color: "#2563eb",
          expiryMode: "PER_GRANT",
          transferable: true,
          redeemable: true,
          exchangeable: true,
          cashEligible: true,
          bankEnabled: true,
          giveEnabled: true,
          giveSource: "BALANCE",
          isPrimary: !existingPrimary,
          sortOrder: 10,
          metadata: { template: "credit-recognition-v1" },
        },
      });
      const r = await tx.pointTypeDefinition.create({
        data: {
          programId,
          code: "R",
          name: "R-credit",
          unitLabel: "R-credit",
          description:
            "Recognition credit. Owned balance never expires; Give uses a separate renewable allowance.",
          color: "#7c3aed",
          expiryMode: "NEVER",
          transferable: true,
          redeemable: true,
          exchangeable: true,
          bankEnabled: true,
          giveEnabled: true,
          giveSource: "BOTH",
          // Governance must set the actual recurring allowance; the template
          // deliberately does not invent a financial policy value.
          allowanceAmount: 0,
          allowanceCycleDays: 30,
          sortOrder: 20,
          metadata: { template: "credit-recognition-v1" },
        },
      });
      await tx.pointTransferRule.createMany({
        data: [
          {
            programId,
            sourcePointTypeId: p.id,
            destinationPointTypeId: r.id,
          },
          {
            programId,
            sourcePointTypeId: r.id,
            destinationPointTypeId: r.id,
          },
        ],
      });
      return { pointTypes: [p, r] };
    });
  }

  async removePointType(programId: string, pointTypeId: string) {
    return this.db.$transaction(async (tx) => {
      const pointType = await resolvePointType(tx, programId, { pointTypeId }, false);
      const [
        transactions,
        redemptions,
        exchanges,
        bankTransactions,
        bankCycles,
        allowances,
        nonZeroWallets,
        fundedBanks,
        rewardPrices,
        pointRules,
        campaigns,
        tiers,
        incomingRules,
      ] = await Promise.all([
        tx.customPointTransaction.count({ where: { pointTypeId } }),
        tx.rewardRedemption.count({ where: { pointTypeId } }),
        tx.pointExchangeRequest.count({ where: { pointTypeId } }),
        tx.pointBankTransaction.count({ where: { pointTypeId } }),
        tx.pointBankCycle.count({ where: { pointTypeId } }),
        tx.pointAllowance.count({ where: { pointTypeId } }),
        tx.customPointWallet.count({ where: { pointTypeId, balance: { not: 0 } } }),
        tx.pointBank.count({ where: { pointTypeId, balance: { not: 0 } } }),
        tx.rewardPointPrice.count({ where: { pointTypeId } }),
        tx.pointRule.count({ where: { pointTypeId } }),
        tx.campaign.count({ where: { pointTypeId, deletedAt: null } }),
        tx.tier.count({ where: { pointTypeId } }),
        tx.pointTransferRule.count({
          where: { destinationPointTypeId: pointTypeId, sourcePointTypeId: { not: pointTypeId } },
        }),
      ]);
      const hasBusinessHistory =
        transactions > 0 ||
        redemptions > 0 ||
        exchanges > 0 ||
        bankTransactions > 0 ||
        bankCycles > 0 ||
        allowances > 0 ||
        nonZeroWallets > 0 ||
        fundedBanks > 0 ||
        rewardPrices > 0 ||
        pointRules > 0 ||
        campaigns > 0 ||
        tiers > 0 ||
        incomingRules > 0;
      if (hasBusinessHistory) {
        const archived = await tx.pointTypeDefinition.update({
          where: { id: pointType.id },
          data: {
            isActive: false,
            isPrimary: false,
            showOnMemberProfile: false,
            archivedAt: new Date(),
          },
        });
        if (pointType.isPrimary) {
          const replacement = await tx.pointTypeDefinition.findFirst({
            where: {
              programId,
              id: { not: pointTypeId },
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
          }
        }
        return { mode: "ARCHIVED" as const, pointType: archived };
      }

      await tx.rewardPointPrice.deleteMany({ where: { pointTypeId } });
      await tx.pointExchangeRate.deleteMany({ where: { pointTypeId } });
      await tx.pointAllowance.deleteMany({ where: { pointTypeId } });
      await tx.pointBankTransaction.deleteMany({ where: { pointTypeId } });
      await tx.pointBankCycle.deleteMany({ where: { pointTypeId } });
      await tx.pointBank.deleteMany({ where: { pointTypeId } });
      await tx.customPointLot.deleteMany({ where: { pointTypeId } });
      await tx.customPointWallet.deleteMany({ where: { pointTypeId } });
      await tx.pointTypeDefinition.delete({ where: { id: pointType.id } });
      if (pointType.isPrimary) {
        const replacement = await tx.pointTypeDefinition.findFirst({
          where: { programId, isActive: true, archivedAt: null },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { id: true },
        });
        if (replacement) {
          await tx.pointTypeDefinition.update({
            where: { id: replacement.id },
            data: { isPrimary: true },
          });
        }
      }
      return { mode: "DELETED" as const, pointType };
    });
  }

  async issueBank(
    programId: string,
    selector: PointTypeSelector,
    amount: number,
    reason: string,
    actor: LedgerActor,
    idempotencyKey: string,
  ) {
    assertPositiveInteger(amount);
    if (!reason.trim()) throw new LoyaltyError("POINT_REASON_REQUIRED", 400);
    return this.db.$transaction(async (tx) => {
      const pointType = await resolvePointType(tx, programId, selector);
      if (!pointType.bankEnabled) throw new LoyaltyError("POINT_BANK_DISABLED", 409);
      return creditBank(tx, {
        programId,
        pointTypeId: pointType.id,
        amount,
        type: "ISSUANCE",
        reason: reason.trim(),
        actorId: actor.id,
        idempotencyKey,
      });
    });
  }

  async banks(programId: string) {
    const types = await this.db.pointTypeDefinition.findMany({
      where: { programId, bankEnabled: true, archivedAt: null },
      include: { banks: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return types.map((pointType) => ({
      pointTypeId: pointType.id,
      code: pointType.code,
      name: pointType.name,
      color: pointType.color,
      balance: pointType.banks[0]?.balance ?? 0,
    }));
  }

  async adjust(
    programId: string,
    memberId: string,
    selector: PointTypeSelector,
    amount: number,
    reason: string,
    actor: LedgerActor,
    idempotencyKey: string,
    explicitExpiry?: Date,
  ) {
    return this.db.$transaction((tx) =>
      this.adjustWithTransaction(
        tx,
        programId,
        memberId,
        selector,
        amount,
        reason,
        actor,
        idempotencyKey,
        explicitExpiry,
      ),
    );
  }

  async adjustWithTransaction(
    tx: Prisma.TransactionClient,
    programId: string,
    memberId: string,
    selector: PointTypeSelector,
    amount: number,
    reason: string,
    actor: LedgerActor,
    idempotencyKey: string,
    explicitExpiry?: Date,
  ) {
    if (!Number.isInteger(amount) || amount === 0)
      throw new LoyaltyError("POINT_AMOUNT_INVALID", 400);
    if (!reason.trim()) throw new LoyaltyError("POINT_REASON_REQUIRED", 400);
    const [pointType, member] = await Promise.all([
      resolvePointType(tx, programId, selector),
      tx.member.findFirst({
        where: { id: memberId, programId, deletedAt: null, status: "ACTIVE" },
      }),
    ]);
    if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
    if (!pointType.allowManualAdjustment)
      throw new LoyaltyError("POINT_MANUAL_ADJUSTMENT_DISABLED", 409);

    if (amount > 0) {
      if (pointType.bankEnabled) {
        await debitBank(tx, {
          programId,
          pointTypeId: pointType.id,
          amount,
          type: "ALLOCATION",
          reason: reason.trim(),
          actorId: actor.id,
          idempotencyKey: `${idempotencyKey}:bank`,
        });
      }
      return creditWallet(tx, {
        memberId,
        programId,
        pointType,
        amount,
        action: "ADJUSTMENT",
        source: `admin:${actor.id}`,
        reason: reason.trim(),
        actor,
        idempotencyKey,
        explicitExpiry,
      });
    }

    const result = await debitWallet(tx, {
      memberId,
      programId,
      pointType,
      amount: Math.abs(amount),
      action: "ADJUSTMENT",
      source: `admin:${actor.id}`,
      reason: reason.trim(),
      actor,
      idempotencyKey,
    });
    if (pointType.bankEnabled) {
      await creditBank(tx, {
        programId,
        pointTypeId: pointType.id,
        amount: Math.abs(amount),
        type: "RETURN",
        reason: reason.trim(),
        actorId: actor.id,
        idempotencyKey: `${idempotencyKey}:bank`,
      });
    }
    return result.transaction;
  }

  async give(
    memberId: string,
    programId: string,
    input: {
      sourcePointTypeId: string;
      destinationPointTypeId: string;
      recipients: { memberId: string; amount: number; message?: string }[];
      fundingSource?: "BALANCE" | "ALLOWANCE";
      message?: string;
      category?: string;
      categoryId?: string;
      idempotencyKey: string;
    },
  ) {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.customPointTransaction.findMany({
        where: {
          programId,
          memberId,
          idempotencyKey: { startsWith: `${input.idempotencyKey}:` },
        },
        orderBy: { createdAt: "asc" },
      });
      if (existing.length > 0) return { transactions: existing, idempotent: true };

      const [sourceType, destinationType, giver, rule] = await Promise.all([
        resolvePointType(tx, programId, { pointTypeId: input.sourcePointTypeId }),
        resolvePointType(tx, programId, { pointTypeId: input.destinationPointTypeId }),
        tx.member.findFirst({
          where: { id: memberId, programId, deletedAt: null, status: "ACTIVE" },
        }),
        tx.pointTransferRule.findFirst({
          where: {
            programId,
            sourcePointTypeId: input.sourcePointTypeId,
            destinationPointTypeId: input.destinationPointTypeId,
            isActive: true,
          },
        }),
      ]);
      if (!giver) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
      if (!sourceType.giveEnabled || !sourceType.transferable)
        throw new LoyaltyError("POINT_GIVE_DISABLED", 409);
      if (!rule) throw new LoyaltyError("POINT_TRANSFER_NOT_ALLOWED", 422);
      const fundingSource =
        sourceType.giveSource === "BOTH" ? input.fundingSource : sourceType.giveSource;
      if (!fundingSource) throw new LoyaltyError("POINT_GIVE_FUNDING_SOURCE_REQUIRED", 400);
      if (
        input.fundingSource &&
        sourceType.giveSource !== "BOTH" &&
        input.fundingSource !== sourceType.giveSource
      ) {
        throw new LoyaltyError("POINT_GIVE_FUNDING_SOURCE_NOT_ALLOWED", 422);
      }
      if (input.recipients.length === 0 || input.recipients.length > sourceType.maxRecipients)
        throw new LoyaltyError("POINT_RECIPIENT_LIMIT", 400);
      if (!sourceType.allowMultiRecipient && input.recipients.length > 1)
        throw new LoyaltyError("POINT_MULTI_RECIPIENT_DISABLED", 422);
      const hasSharedMessage = Boolean(input.message?.trim());
      const allRecipientsHaveMessage = input.recipients.every((recipient) =>
        Boolean(recipient.message?.trim()),
      );
      if (sourceType.requireGiveMessage && !hasSharedMessage && !allRecipientsHaveMessage)
        throw new LoyaltyError("POINT_GIVE_MESSAGE_REQUIRED", 400);

      const recipientIds = input.recipients.map((recipient) => recipient.memberId);
      if (new Set(recipientIds).size !== recipientIds.length)
        throw new LoyaltyError("POINT_DUPLICATE_RECIPIENT", 400);
      if (recipientIds.includes(memberId)) throw new LoyaltyError("POINT_SELF_GIVE_FORBIDDEN", 422);
      const recipients = await tx.member.findMany({
        where: {
          id: { in: recipientIds },
          programId,
          deletedAt: null,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      if (recipients.length !== recipientIds.length)
        throw new LoyaltyError("POINT_RECIPIENT_NOT_FOUND", 404);

      const sourceTotal = input.recipients.reduce((sum, recipient) => {
        assertPositiveInteger(recipient.amount);
        if (recipient.amount % rule.sourceAmount !== 0)
          throw new LoyaltyError("POINT_TRANSFER_RATIO_INVALID", 422);
        return sum + recipient.amount;
      }, 0);

      let allowance: Awaited<ReturnType<typeof activeAllowance>> | undefined;
      if (fundingSource === "ALLOWANCE") {
        allowance = await activeAllowance(tx, memberId, sourceType);
        const changed = await tx.pointAllowance.updateMany({
          where: { id: allowance.id, remaining: { gte: sourceTotal } },
          data: { remaining: { decrement: sourceTotal } },
        });
        if (changed.count !== 1) throw new LoyaltyError("POINT_ALLOWANCE_INSUFFICIENT", 422);
        if (sourceType.bankEnabled) {
          await debitBank(tx, {
            programId,
            pointTypeId: sourceType.id,
            amount: sourceTotal,
            type: "GIVE_ALLOCATION",
            reason: "Give allowance used",
            actorId: memberId,
            idempotencyKey: `${input.idempotencyKey}:bank`,
          });
        }
      }

      const transactions: CustomPointTransaction[] = [];
      for (const [index, recipient] of input.recipients.entries()) {
        if (sourceType.pairLimit != null) {
          const since = new Date(Date.now() - sourceType.pairLimitPeriodDays * DAY_MS);
          const previousPairEntries = await tx.customPointTransaction.findMany({
            where: {
              memberId,
              pointTypeId: sourceType.id,
              counterpartyMemberId: recipient.memberId,
              action: { in: ["GIVE_OUT", "GIVE_ALLOWANCE_OUT"] },
              createdAt: { gte: since },
            },
            select: { action: true, amount: true, metadata: true },
          });
          const previousPairTotal = previousPairEntries.reduce((sum, entry) => {
            if (entry.action === "GIVE_OUT") return sum + Math.abs(entry.amount);
            const metadata =
              entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
                ? (entry.metadata as Record<string, unknown>)
                : {};
            return sum + Number(metadata.allowanceSpent ?? 0);
          }, 0);
          if (previousPairTotal + recipient.amount > sourceType.pairLimit)
            throw new LoyaltyError("POINT_PAIR_LIMIT_EXCEEDED", 422);
        }

        const recipientMessage = recipient.message?.trim();
        const message = recipientMessage ? recipientMessage : input.message?.trim();
        const destinationAmount = (recipient.amount / rule.sourceAmount) * rule.destinationAmount;
        const outKey = `${input.idempotencyKey}:${String(index)}:out`;
        const inKey = `${input.idempotencyKey}:${String(index)}:in`;
        if (fundingSource === "ALLOWANCE") {
          transactions.push(
            await neutralAllowanceEntry(tx, {
              memberId,
              programId,
              pointType: sourceType,
              action: "GIVE_ALLOWANCE_OUT",
              source: "member:give",
              idempotencyKey: outKey,
              message,
              category: input.category,
              categoryId: input.categoryId,
              counterpartyMemberId: recipient.memberId,
              sourcePointTypeId: sourceType.id,
              destinationPointTypeId: destinationType.id,
              actor: { type: "MEMBER", id: memberId },
              allowanceSpent: recipient.amount,
              metadata: {
                allowanceId: allowance?.id,
                fundingSource,
                sourceAmount: recipient.amount,
                destinationAmount,
              },
            }),
          );
        } else {
          const debit = await debitWallet(tx, {
            memberId,
            programId,
            pointType: sourceType,
            amount: recipient.amount,
            action: "GIVE_OUT",
            source: "member:give",
            idempotencyKey: outKey,
            message,
            category: input.category,
            categoryId: input.categoryId,
            counterpartyMemberId: recipient.memberId,
            sourcePointTypeId: sourceType.id,
            destinationPointTypeId: destinationType.id,
            actor: { type: "MEMBER", id: memberId },
            metadata: { fundingSource, sourceAmount: recipient.amount, destinationAmount },
          });
          transactions.push(debit.transaction);
        }
        transactions.push(
          await creditWallet(tx, {
            memberId: recipient.memberId,
            programId,
            pointType: destinationType,
            amount: destinationAmount,
            action: "GIVE_IN",
            source: "member:give",
            idempotencyKey: inKey,
            message,
            category: input.category,
            categoryId: input.categoryId,
            counterpartyMemberId: memberId,
            sourcePointTypeId: sourceType.id,
            destinationPointTypeId: destinationType.id,
            actor: { type: "MEMBER", id: memberId },
            metadata: { fundingSource, sourceAmount: recipient.amount, destinationAmount },
          }),
        );
      }
      return { transactions, idempotent: false };
    });
  }

  async history(
    programId: string,
    input: {
      memberId?: string;
      pointTypeId?: string;
      action?: string;
      counterpartyMemberId?: string;
      categoryId?: string;
      from?: Date;
      to?: Date;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    const where: Prisma.CustomPointTransactionWhereInput = {
      programId,
      ...(input.memberId ? { memberId: input.memberId } : {}),
      ...(input.pointTypeId ? { pointTypeId: input.pointTypeId } : {}),
      ...(input.action ? { action: input.action } : {}),
      ...(input.counterpartyMemberId ? { counterpartyMemberId: input.counterpartyMemberId } : {}),
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.from !== undefined || input.to !== undefined
        ? {
            createdAt: {
              ...(input.from ? { gte: input.from } : {}),
              ...(input.to ? { lte: input.to } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.customPointTransaction.findMany({
        where,
        include: {
          pointType: {
            select: { id: true, code: true, name: true, unitLabel: true, color: true },
          },
          counterparty: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          member: { select: { id: true, firstName: true, lastName: true, email: true } },
          categoryRef: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.customPointTransaction.count({ where }),
    ]);
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async createExchangeRate(
    programId: string,
    selector: PointTypeSelector,
    input: {
      valueMinorPerPoint: number;
      currency: string;
      payoutMechanism: string;
      payoutType: "CASH" | "NON_CASH";
      minPoints: number;
      maxPoints?: number;
      periodLimitPoints?: number;
      periodDays: number;
    },
  ) {
    return this.db.$transaction(async (tx) => {
      const pointType = await resolvePointType(tx, programId, selector);
      if (!pointType.exchangeable) throw new LoyaltyError("POINT_EXCHANGE_DISABLED", 409);
      if (input.payoutType === "CASH" && !pointType.cashEligible)
        throw new LoyaltyError("POINT_CASH_EXCHANGE_DISABLED", 409);
      const latest = await tx.pointExchangeRate.findFirst({
        where: { programId, pointTypeId: pointType.id },
        orderBy: { version: "desc" },
      });
      await tx.pointExchangeRate.updateMany({
        where: {
          programId,
          pointTypeId: pointType.id,
          payoutType: input.payoutType,
          isActive: true,
        },
        data: { isActive: false },
      });
      return tx.pointExchangeRate.create({
        data: {
          programId,
          pointTypeId: pointType.id,
          version: (latest?.version ?? 0) + 1,
          valueMinorPerPoint: input.valueMinorPerPoint,
          currency: input.currency.toUpperCase(),
          payoutMechanism: input.payoutMechanism,
          payoutType: input.payoutType,
          minPoints: input.minPoints,
          maxPoints: input.maxPoints,
          periodLimitPoints: input.periodLimitPoints,
          periodDays: input.periodDays,
        },
        include: { pointType: true },
      });
    });
  }

  async exchangeRates(programId: string, activeOnly = true) {
    return this.db.pointExchangeRate.findMany({
      where: {
        programId,
        ...(activeOnly ? { isActive: true, pointType: { isActive: true, archivedAt: null } } : {}),
      },
      include: { pointType: true },
      orderBy: [{ pointType: { sortOrder: "asc" } }, { version: "desc" }],
    });
  }

  async exchange(
    memberId: string,
    programId: string,
    input: {
      pointTypeId: string;
      amount: number;
      payoutType: "CASH" | "NON_CASH";
      idempotencyKey: string;
    },
  ) {
    assertPositiveInteger(input.amount);
    return this.db.$transaction(async (tx) => {
      const existing = await tx.pointExchangeRequest.findUnique({
        where: {
          programId_idempotencyKey: {
            programId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) {
        if (
          existing.memberId !== memberId ||
          existing.pointTypeId !== input.pointTypeId ||
          existing.amount !== input.amount ||
          existing.payoutType !== input.payoutType
        )
          throw new LoyaltyError("POINT_IDEMPOTENCY_CONFLICT", 409);
        return { request: existing, idempotent: true };
      }
      const pointType = await resolvePointType(tx, programId, {
        pointTypeId: input.pointTypeId,
      });
      if (!pointType.exchangeable) throw new LoyaltyError("POINT_EXCHANGE_DISABLED", 409);
      if (input.payoutType === "CASH" && !pointType.cashEligible)
        throw new LoyaltyError("POINT_CASH_EXCHANGE_DISABLED", 422);
      const rate = await tx.pointExchangeRate.findFirst({
        where: {
          programId,
          pointTypeId: pointType.id,
          payoutType: input.payoutType,
          isActive: true,
        },
        orderBy: { version: "desc" },
      });
      if (!rate) throw new LoyaltyError("POINT_EXCHANGE_RATE_NOT_FOUND", 404);
      if (input.amount < rate.minPoints || (rate.maxPoints && input.amount > rate.maxPoints))
        throw new LoyaltyError("POINT_EXCHANGE_AMOUNT_OUT_OF_RANGE", 422);
      if (rate.periodLimitPoints != null) {
        const since = new Date(Date.now() - rate.periodDays * DAY_MS);
        const used = await tx.pointExchangeRequest.aggregate({
          where: {
            memberId,
            pointTypeId: pointType.id,
            requestedAt: { gte: since },
            status: { notIn: ["CANCELLED", "REJECTED"] },
          },
          _sum: { amount: true },
        });
        if ((used._sum.amount ?? 0) + input.amount > rate.periodLimitPoints)
          throw new LoyaltyError("POINT_EXCHANGE_PERIOD_LIMIT", 422);
      }
      const request = await tx.pointExchangeRequest.create({
        data: {
          programId,
          documentNumber: exchangeDocumentNumber(),
          memberId,
          pointTypeId: pointType.id,
          amount: input.amount,
          valueMinor: input.amount * rate.valueMinorPerPoint,
          currency: rate.currency,
          payoutMechanism: rate.payoutMechanism,
          payoutType: input.payoutType,
          exchangeRateId: rate.id,
          idempotencyKey: input.idempotencyKey,
        },
      });
      const debit = await debitWallet(tx, {
        memberId,
        programId,
        pointType,
        amount: input.amount,
        action: "EXCHANGE",
        source: "member:exchange",
        idempotencyKey: `${input.idempotencyKey}:ledger`,
        exchangeRateId: rate.id,
        exchangeRequestId: request.id,
        actor: { type: "MEMBER", id: memberId },
        metadata: {
          valueMinor: request.valueMinor,
          currency: request.currency,
          payoutType: request.payoutType,
        },
      });
      return { request, transaction: debit.transaction, idempotent: false };
    });
  }

  async exchangeRequests(
    programId: string,
    input: { status?: PointExchangeStatus; memberId?: string; page?: number; pageSize?: number },
  ) {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 50;
    const where = {
      programId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.memberId ? { memberId: input.memberId } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.pointExchangeRequest.findMany({
        where,
        include: {
          pointType: { select: { id: true, code: true, name: true, unitLabel: true } },
          member: { select: { id: true, firstName: true, lastName: true, email: true } },
          exchangeRate: true,
        },
        orderBy: { requestedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.pointExchangeRequest.count({ where }),
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async updateExchangeRequest(
    programId: string,
    requestId: string,
    status: "APPROVED" | "COMPLETED" | "CANCELLED" | "REJECTED",
    actor: LedgerActor,
    details: { note?: string; reference?: string; reason?: string } = {},
  ) {
    return this.db.$transaction(async (tx) => {
      const request = await tx.pointExchangeRequest.findFirst({
        where: { id: requestId, programId },
        include: { pointType: true, transaction: true },
      });
      if (!request) throw new LoyaltyError("POINT_EXCHANGE_REQUEST_NOT_FOUND", 404);
      const transitions: Record<string, string[]> = {
        PENDING: ["APPROVED", "CANCELLED", "REJECTED"],
        APPROVED: ["COMPLETED", "CANCELLED"],
        COMPLETED: [],
        CANCELLED: [],
        REJECTED: [],
      };
      if (!transitions[request.status]?.includes(status))
        throw new LoyaltyError("POINT_EXCHANGE_STATUS_INVALID", 409);
      if ((status === "CANCELLED" || status === "REJECTED") && !details.reason?.trim())
        throw new LoyaltyError("POINT_REASON_REQUIRED", 400);
      if (status === "COMPLETED" && !details.reference?.trim())
        throw new LoyaltyError("POINT_EXCHANGE_COMPLETION_REFERENCE_REQUIRED", 400);

      if (status === "CANCELLED" || status === "REJECTED") {
        const consumedLots =
          request.transaction?.metadata &&
          typeof request.transaction.metadata === "object" &&
          !Array.isArray(request.transaction.metadata) &&
          Array.isArray((request.transaction.metadata as Record<string, unknown>).consumedLots)
            ? ((request.transaction.metadata as Record<string, unknown>).consumedLots as {
                amount: number;
                expiresAt: string | null;
              }[])
            : [];
        await creditWallet(tx, {
          memberId: request.memberId,
          programId,
          pointType: request.pointType,
          amount: request.amount,
          action: "REVERSAL",
          source: "admin:exchange-cancel",
          idempotencyKey: `exchange-refund:${request.id}`,
          reason: details.reason?.trim(),
          actor,
          exchangeRateId: request.exchangeRateId,
          restoredLots:
            consumedLots.length > 0
              ? consumedLots.map((lot) => ({
                  amount: lot.amount,
                  expiresAt: lot.expiresAt ? new Date(lot.expiresAt) : null,
                }))
              : undefined,
          metadata: { exchangeRequestId: request.id },
        });
      }
      return tx.pointExchangeRequest.update({
        where: { id: request.id },
        data: {
          status,
          approvedAt: status === "APPROVED" ? new Date() : request.approvedAt,
          approvedBy: status === "APPROVED" ? actor.id : request.approvedBy,
          approvalNote: status === "APPROVED" ? details.note?.trim() : request.approvalNote,
          completedAt: status === "COMPLETED" ? new Date() : request.completedAt,
          completedBy: status === "COMPLETED" ? actor.id : request.completedBy,
          completionReference:
            status === "COMPLETED" ? details.reference?.trim() : request.completionReference,
          completionNote: status === "COMPLETED" ? details.note?.trim() : request.completionNote,
          cancelledAt:
            status === "CANCELLED" || status === "REJECTED" ? new Date() : request.cancelledAt,
          cancelledBy:
            status === "CANCELLED" || status === "REJECTED" ? actor.id : request.cancelledBy,
          cancellationReason:
            status === "CANCELLED" || status === "REJECTED"
              ? details.reason?.trim()
              : request.cancellationReason,
        },
      });
    });
  }

  async redeemReward(
    rewardId: string,
    memberId: string,
    programId: string,
    pointTypeId: string,
    idempotencyKey: string,
  ) {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.customPointTransaction.findUnique({
        where: { programId_idempotencyKey: { programId, idempotencyKey } },
      });
      if (existing) {
        if (
          existing.memberId !== memberId ||
          existing.pointTypeId !== pointTypeId ||
          existing.action !== "REDEEM" ||
          existing.source !== `reward:${rewardId}`
        )
          throw new LoyaltyError("POINT_IDEMPOTENCY_CONFLICT", 409);
        const redemption = await tx.rewardRedemption.findUnique({
          where: { pointTransactionId: existing.id },
        });
        return { transaction: existing, redemption, idempotent: true };
      }
      const [reward, member, pointType] = await Promise.all([
        tx.reward.findFirst({
          where: { id: rewardId, programId, deletedAt: null },
          include: { pointPrices: true },
        }),
        tx.member.findFirst({
          where: { id: memberId, programId, deletedAt: null, status: "ACTIVE" },
        }),
        resolvePointType(tx, programId, { pointTypeId }),
      ]);
      if (!reward || !reward.isActive) throw new LoyaltyError("REWARD_NOT_ACTIVE", 409);
      if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
      const now = new Date();
      if (
        (reward.availableFrom !== null && reward.availableFrom > now) ||
        (reward.availableUntil !== null && reward.availableUntil <= now)
      )
        throw new LoyaltyError("REWARD_NOT_AVAILABLE", 409);
      if (!pointType.redeemable) throw new LoyaltyError("POINT_REDEEM_DISABLED", 409);
      const price = reward.pointPrices.find((candidate) => candidate.pointTypeId === pointType.id);
      if (!price) throw new LoyaltyError("REWARD_POINT_TYPE_NOT_ACCEPTED", 422);
      if (reward.tierRequired) {
        const [memberTier, requiredTier] = await Promise.all([
          tx.memberTier.findFirst({
            where: { memberId, downgradedAt: null },
            include: { tier: true },
          }),
          tx.tier.findFirst({ where: { programId, name: reward.tierRequired } }),
        ]);
        if (!requiredTier || !memberTier || memberTier.tier.rank < requiredTier.rank)
          throw new LoyaltyError("REWARD_TIER_INSUFFICIENT", 422);
      }
      if (reward.stock != null) {
        const stock = await tx.reward.updateMany({
          where: { id: reward.id, stock: { gt: 0 } },
          data: { stock: { decrement: 1 } },
        });
        if (stock.count !== 1) throw new LoyaltyError("REWARD_OUT_OF_STOCK", 409);
      }
      const debit = await debitWallet(tx, {
        memberId,
        programId,
        pointType,
        amount: price.amount,
        action: "REDEEM",
        source: `reward:${reward.id}`,
        reason: `Reward redemption: ${reward.name}`,
        idempotencyKey,
        actor: { type: "MEMBER", id: memberId },
        metadata: { rewardId: reward.id, pointTypeId: pointType.id },
      });
      const redemption = await tx.rewardRedemption.create({
        data: {
          rewardId: reward.id,
          memberId,
          pointTypeId: pointType.id,
          pointTransactionId: debit.transaction.id,
          pointsSpent: price.amount,
          metadata: { idempotencyKey },
        },
      });
      return { transaction: debit.transaction, redemption, idempotent: false };
    });
  }

  async cancelRewardRedemption(
    programId: string,
    redemptionId: string,
    actor: LedgerActor,
    reason: string,
  ) {
    if (!reason.trim()) throw new LoyaltyError("POINT_REASON_REQUIRED", 400);
    return this.db.$transaction(async (tx) => {
      const redemption = await tx.rewardRedemption.findFirst({
        where: { id: redemptionId, reward: { programId } },
        include: { reward: true, pointType: true },
      });
      if (!redemption) throw new LoyaltyError("REWARD_REDEMPTION_NOT_FOUND", 404);
      if (redemption.fulfillmentStatus === "CANCELLED") return redemption;
      if (redemption.fulfillmentStatus === "FULFILLED")
        throw new LoyaltyError("REWARD_REDEMPTION_ALREADY_FULFILLED", 409);
      if (!redemption.pointType || !redemption.pointTransactionId)
        throw new LoyaltyError("REWARD_REDEMPTION_LEGACY_REFUND_REQUIRED", 409);
      const original = await tx.customPointTransaction.findUnique({
        where: { id: redemption.pointTransactionId },
      });
      if (!original) throw new LoyaltyError("POINT_TRANSACTION_NOT_FOUND", 404);
      const consumedLots =
        original.metadata &&
        typeof original.metadata === "object" &&
        !Array.isArray(original.metadata) &&
        Array.isArray((original.metadata as Record<string, unknown>).consumedLots)
          ? ((original.metadata as Record<string, unknown>).consumedLots as {
              amount: number;
              expiresAt: string | null;
            }[])
          : [];
      await creditWallet(tx, {
        memberId: redemption.memberId,
        programId,
        pointType: redemption.pointType,
        amount: redemption.pointsSpent,
        action: "REVERSAL",
        source: "admin:reward-cancel",
        idempotencyKey: `reward-refund:${redemption.id}`,
        reason: reason.trim(),
        actor,
        restoredLots:
          consumedLots.length > 0
            ? consumedLots.map((lot) => ({
                amount: lot.amount,
                expiresAt: lot.expiresAt ? new Date(lot.expiresAt) : null,
              }))
            : undefined,
        metadata: {
          rewardId: redemption.rewardId,
          redemptionId: redemption.id,
          reversedTransactionId: original.id,
        },
      });
      if (redemption.reward.stock != null) {
        await tx.reward.update({
          where: { id: redemption.rewardId },
          data: { stock: { increment: 1 } },
        });
      }
      return tx.rewardRedemption.update({
        where: { id: redemption.id },
        data: { fulfillmentStatus: "CANCELLED", cancelledAt: new Date() },
      });
    });
  }

  async expire(programId: string): Promise<number> {
    const candidates = await this.db.customPointLot.findMany({
      where: {
        programId,
        remainingAmount: { gt: 0 },
        expiresAt: { lte: new Date() },
      },
      include: { pointType: true },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
      take: 500,
    });
    let expired = 0;
    for (const candidate of candidates) {
      const changed = await this.db.$transaction(async (tx) => {
        const lot = await tx.customPointLot.findUnique({ where: { id: candidate.id } });
        if (!lot || lot.remainingAmount <= 0) return false;
        const wallet = await tx.customPointWallet.findUniqueOrThrow({
          where: { id: lot.walletId },
        });
        const amount = Math.min(lot.remainingAmount, Math.max(wallet.balance, 0));
        if (amount <= 0) {
          await tx.customPointLot.update({
            where: { id: lot.id },
            data: { remainingAmount: 0 },
          });
          return false;
        }
        await debitWallet(tx, {
          memberId: lot.memberId,
          programId,
          pointType: candidate.pointType,
          amount,
          action: "EXPIRATION",
          source: "system:expiration",
          reason: `Expired lot ${lot.id}`,
          idempotencyKey: `point-expire:${lot.id}`,
          actor: { type: "SYSTEM", id: "point-expiration" },
          metadata: { lotId: lot.id, grantTransactionId: lot.grantTransactionId },
        });
        return true;
      });
      if (changed) expired += 1;
    }
    return expired;
  }

  async expiringNotices(programId: string) {
    const types = await this.db.pointTypeDefinition.findMany({
      where: {
        programId,
        archivedAt: null,
        expiryMode: { not: "NEVER" },
      },
    });
    const warningByType = new Map(types.map((type) => [type.id, type.expiryWarningDays]));
    const maxDays = Math.max(0, ...types.flatMap((type) => type.expiryWarningDays));
    const now = new Date();
    const lots = await this.db.customPointLot.findMany({
      where: {
        programId,
        remainingAmount: { gt: 0 },
        expiresAt: { gt: now, lte: new Date(now.getTime() + maxDays * DAY_MS) },
        member: { status: "ACTIVE", deletedAt: null },
      },
      include: {
        pointType: { select: { code: true, name: true, unitLabel: true } },
        member: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            locale: true,
          },
        },
      },
    });
    const notices = [];
    for (const lot of lots) {
      if (!lot.expiresAt) continue;
      const days = Math.ceil((lot.expiresAt.getTime() - now.getTime()) / DAY_MS);
      const warning = warningByType
        .get(lot.pointTypeId)
        ?.find((candidate) => candidate >= days && !lot.warningDaysSent.includes(candidate));
      if (warning == null) continue;
      notices.push({
        lotId: lot.id,
        memberId: lot.memberId,
        pointType: lot.pointType,
        amount: lot.remainingAmount,
        expiresAt: lot.expiresAt,
        days: warning,
        member: lot.member,
      });
    }
    return notices;
  }

  async markExpiryNoticeSent(lotId: string, warningDays: number): Promise<void> {
    await this.db.customPointLot.updateMany({
      where: { id: lotId, NOT: { warningDaysSent: { has: warningDays } } },
      data: { warningDaysSent: { push: warningDays } },
    });
  }

  async clearMember(
    programId: string,
    memberId: string,
    actor: LedgerActor,
    reason: string,
    idempotencyKey: string,
  ) {
    return this.db.$transaction((tx) =>
      this.clearMemberWithTransaction(tx, programId, memberId, actor, reason, idempotencyKey),
    );
  }

  async clearMemberWithTransaction(
    tx: Prisma.TransactionClient,
    programId: string,
    memberId: string,
    actor: LedgerActor,
    reason: string,
    idempotencyKey: string,
  ) {
    if (!reason.trim()) throw new LoyaltyError("POINT_REASON_REQUIRED", 400);
    const member = await tx.member.findFirst({ where: { id: memberId, programId } });
    if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
    const wallets = await tx.customPointWallet.findMany({
      where: { memberId, programId, balance: { gt: 0 } },
      include: { pointType: true },
    });
    const transactions = [];
    for (const wallet of wallets) {
      const result = await debitWallet(tx, {
        memberId,
        programId,
        pointType: wallet.pointType,
        amount: wallet.balance,
        action: "CLEARANCE",
        source: "system:offboarding",
        reason: reason.trim(),
        idempotencyKey: `${idempotencyKey}:${wallet.pointTypeId}`,
        actor,
      });
      transactions.push(result.transaction);
      if (wallet.pointType.bankEnabled) {
        await creditBank(tx, {
          programId,
          pointTypeId: wallet.pointTypeId,
          amount: wallet.balance,
          type: "RETURN",
          reason: reason.trim(),
          actorId: actor.id,
          idempotencyKey: `${idempotencyKey}:${wallet.pointTypeId}:bank`,
        });
      }
    }
    await tx.pointAllowance.updateMany({
      where: { memberId, programId, cycleEnd: { gt: new Date() } },
      data: { remaining: 0 },
    });
    await tx.member.update({
      where: { id: memberId },
      data: {
        status: "INACTIVE",
        deactivatedAt: member.deactivatedAt ?? new Date(),
        deletedAt: member.deletedAt ?? new Date(),
      },
    });
    return transactions;
  }
}

export const walletService = new WalletService();
