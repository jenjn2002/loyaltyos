import crypto from "node:crypto";

import type {
  CreditTransactionType,
  CreditType,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { prisma } from "../db.js";
import { LoyaltyError } from "./errors.js";

export type CreditKind = "P" | "R";

export interface CreditBalance {
  creditType: CreditKind;
  balance: number;
  totalGranted: number;
  totalSpent: number;
}

export interface GiveRecipient {
  memberId: string;
  amount: number;
  message?: string;
  categoryId?: string;
}

function asKind(value: CreditType): CreditKind {
  return value;
}

function jsonValue(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  return value as Prisma.InputJsonValue | undefined;
}

export class CreditService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async balances(memberId: string, programId: string): Promise<CreditBalance[]> {
    const wallets = await this.db.creditWallet.findMany({
      where: { memberId, programId },
      orderBy: { creditType: "asc" },
    });
    const byType = new Map(wallets.map((wallet) => [asKind(wallet.creditType), wallet]));
    return (["P", "R"] as CreditKind[]).map((creditType) => {
      const wallet = byType.get(creditType);
      return {
        creditType,
        balance: wallet?.balance ?? 0,
        totalGranted: wallet?.totalGranted ?? 0,
        totalSpent: wallet?.totalSpent ?? 0,
      };
    });
  }

  async history(
    memberId: string,
    programId: string,
    input: { page?: number; pageSize?: number; creditType?: CreditKind } = {},
  ) {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 50;
    const where = {
      memberId,
      programId,
      ...(input.creditType ? { creditType: input.creditType as CreditType } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.creditTransaction.findMany({
        where,
        include: {
          counterparty: { select: { id: true, firstName: true, lastName: true, email: true } },
          categoryRef: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.creditTransaction.count({ where }),
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async give(
    giverId: string,
    programId: string,
    input: {
      creditType: CreditKind;
      recipients: GiveRecipient[];
      message: string;
      category?: string;
      categoryId?: string;
      idempotencyKey: string;
    },
  ) {
    if (!input.message.trim()) throw new LoyaltyError("CREDIT_MESSAGE_REQUIRED", 400);
    if (input.recipients.length === 0) throw new LoyaltyError("CREDIT_RECIPIENT_REQUIRED", 400);
    if (input.recipients.some((recipient) => recipient.memberId === giverId)) {
      throw new LoyaltyError("CREDIT_SELF_GIVE_NOT_ALLOWED", 400);
    }
    if (input.recipients.some((recipient) => !Number.isInteger(recipient.amount) || recipient.amount <= 0)) {
      throw new LoyaltyError("CREDIT_AMOUNT_INVALID", 400);
    }

    return this.db.$transaction(async (tx) => {
      const existing = await tx.creditTransaction.findFirst({
        where: { idempotencyKey: `${input.idempotencyKey}:out:0` },
      });
      if (existing) return { idempotent: true, transactionIds: [existing.id] };

      const [giver, program] = await Promise.all([
        tx.member.findFirst({ where: { id: giverId, programId, deletedAt: null, status: "ACTIVE" } }),
        tx.program.findUnique({
          where: { id: programId },
          select: { creditGivingLimit: true, creditGivingPeriodDays: true, creditGivingPairLimit: true },
        }),
      ]);
      if (!giver) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
      if (input.categoryId) {
        const category = await tx.creditCategory.findFirst({ where: { id: input.categoryId, programId, isActive: true } });
        if (!category) throw new LoyaltyError("CREDIT_CATEGORY_NOT_FOUND", 404);
      }

      const uniqueRecipients = new Set(input.recipients.map((recipient) => recipient.memberId));
      if (uniqueRecipients.size !== input.recipients.length) {
        throw new LoyaltyError("CREDIT_DUPLICATE_RECIPIENT", 400);
      }
      const recipients = await tx.member.findMany({
        where: { id: { in: [...uniqueRecipients] }, programId, deletedAt: null, status: "ACTIVE" },
        select: { id: true },
      });
      if (recipients.length !== uniqueRecipients.size) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);

      const periodStart = new Date(
        Date.now() - (program?.creditGivingPeriodDays ?? 30) * 24 * 60 * 60 * 1000,
      );
      // The recurring giving allowance applies to recognition credits. P-credit
      // is governed by its own balance and expiry date instead of a reset quota.
      if (input.creditType === "R" && program?.creditGivingLimit != null) {
        const spent = await tx.creditTransaction.aggregate({
          where: {
            memberId: giverId,
            programId,
            creditType: input.creditType as CreditType,
            type: "GIVE_OUT",
            createdAt: { gte: periodStart },
          },
          _sum: { amount: true },
        });
        const alreadyGiven = Math.abs(spent._sum.amount ?? 0);
        const requested = input.recipients.reduce((sum, recipient) => sum + recipient.amount, 0);
        if (alreadyGiven + requested > program.creditGivingLimit) {
          throw new LoyaltyError("CREDIT_GIVING_LIMIT_REACHED", 422);
        }
      }

      const transactionIds: string[] = [];
      for (const [index, recipient] of input.recipients.entries()) {
        if (input.creditType === "R" && program?.creditGivingPairLimit != null) {
          const pair = await tx.creditTransaction.aggregate({
            where: {
              memberId: giverId,
              counterpartyMemberId: recipient.memberId,
              programId,
              type: "GIVE_OUT",
              createdAt: { gte: periodStart },
            },
            _sum: { amount: true },
          });
          if (Math.abs(pair._sum.amount ?? 0) + recipient.amount > program.creditGivingPairLimit) {
            throw new LoyaltyError("CREDIT_GIVING_PAIR_LIMIT_REACHED", 422);
          }
        }

        const debit = await this.debitWallet(tx, {
          memberId: giverId,
          programId,
          creditType: input.creditType,
          amount: recipient.amount,
          type: "GIVE_OUT",
          source: "recognition",
          message: input.message.trim(),
          category: input.category,
          categoryId: input.categoryId ?? recipient.categoryId,
          sourceCreditType: input.creditType,
          receivedCreditType: "R",
          actorType: "MEMBER",
          actorId: giverId,
          counterpartyMemberId: recipient.memberId,
          idempotencyKey: `${input.idempotencyKey}:out:${String(index)}`,
          metadata: { receiverCreditType: "R" },
        });
        transactionIds.push(debit.id);

        const credit = await this.creditWallet(tx, {
          memberId: recipient.memberId,
          programId,
          creditType: "R",
          amount: recipient.amount,
          type: "GIVE_IN",
          source: "recognition",
          message: recipient.message?.trim() || input.message.trim(),
          category: input.category,
          categoryId: input.categoryId ?? recipient.categoryId,
          sourceCreditType: input.creditType,
          receivedCreditType: "R",
          actorType: "MEMBER",
          actorId: giverId,
          counterpartyMemberId: giverId,
          idempotencyKey: `${input.idempotencyKey}:in:${String(index)}`,
          metadata: { giverCreditType: input.creditType, receiverCreditType: "R" },
        });
        transactionIds.push(credit.id);
      }

      return { idempotent: false, transactionIds };
    });
  }

  async exchange(
    memberId: string,
    programId: string,
    input: {
      creditType: CreditKind;
      amount: number;
      payoutType: "CASH" | "NON_CASH";
      idempotencyKey: string;
    },
  ) {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new LoyaltyError("CREDIT_AMOUNT_INVALID", 400);
    }
    if (input.creditType === "R" && input.payoutType === "CASH") {
      throw new LoyaltyError("R_CREDIT_CASH_EXCHANGE_NOT_ALLOWED", 422);
    }

    return this.db.$transaction(async (tx) => {
      const existingRequest = await tx.creditExchangeRequest.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { exchangeRate: true, transaction: true },
      });
      if (existingRequest) {
        const rate = existingRequest.exchangeRate;
        return {
          requestId: existingRequest.id,
          transactionId: existingRequest.transaction?.id ?? null,
          status: existingRequest.status,
          amount: existingRequest.amount,
          valueMinorUnits: existingRequest.valueMinor,
          currency: rate.currency,
          payoutMechanism: rate.payoutMechanism,
          rateVersion: rate.version,
          idempotent: true,
        };
      }

      const existing = await tx.creditTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { exchangeRate: true },
      });
      if (existing) {
        const rate = existing.exchangeRate;
        return {
          requestId: existing.exchangeRequestId,
          transactionId: existing.id,
          status: "PENDING",
          amount: Math.abs(existing.amount),
          valueMinorUnits: Math.abs(existing.amount) * (rate?.valueMinorPerCredit ?? 0),
          currency: rate?.currency ?? "",
          payoutMechanism: rate?.payoutMechanism ?? "",
          rateVersion: rate?.version ?? 0,
          idempotent: true,
        };
      }

      const member = await tx.member.findFirst({
        where: { id: memberId, programId, deletedAt: null, status: "ACTIVE" },
        select: { id: true },
      });
      if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);

      const rate = await tx.creditExchangeRate.findFirst({
        where: { programId, creditType: input.creditType as CreditType, isActive: true },
        orderBy: { version: "desc" },
      });
      if (!rate) throw new LoyaltyError("CREDIT_EXCHANGE_NOT_CONFIGURED", 409);
      if (input.payoutType === "CASH" && !rate.cashEligible) {
        throw new LoyaltyError("CASH_PAYOUT_NOT_CONFIGURED", 409);
      }
      if (input.amount < rate.minCredits || (rate.maxCredits != null && input.amount > rate.maxCredits)) {
        throw new LoyaltyError("CREDIT_EXCHANGE_AMOUNT_OUT_OF_RANGE", 422);
      }

      const valueMinor = input.amount * rate.valueMinorPerCredit;
      const request = await tx.creditExchangeRequest.create({
        data: {
          programId,
          memberId,
          creditType: input.creditType as CreditType,
          amount: input.amount,
          valueMinor,
          currency: rate.currency,
          payoutMechanism: rate.payoutMechanism,
          payoutType: input.payoutType,
          exchangeRateId: rate.id,
          idempotencyKey: input.idempotencyKey,
          metadata: jsonValue({ rateVersion: rate.version }),
        },
      });

      const transaction = await this.debitWallet(tx, {
        memberId,
        programId,
        creditType: input.creditType,
        amount: input.amount,
        type: "EXCHANGE",
        source: `exchange:${input.payoutType.toLowerCase()}`,
        reason: `${rate.payoutMechanism} exchange at rate v${String(rate.version)}`,
        idempotencyKey: input.idempotencyKey,
        exchangeRateId: rate.id,
        exchangeRequestId: request.id,
        actorType: "MEMBER",
        actorId: memberId,
        metadata: {
          payoutType: input.payoutType,
          valueMinorUnits: valueMinor,
          currency: rate.currency,
          rateVersion: rate.version,
        },
      });
      return {
        requestId: request.id,
        transactionId: transaction.id,
        status: request.status,
        amount: input.amount,
        valueMinorUnits: valueMinor,
        currency: rate.currency,
        payoutMechanism: rate.payoutMechanism,
        rateVersion: rate.version,
        idempotent: false,
      };
    });
  }

  async rates(programId: string) {
    return this.db.creditExchangeRate.findMany({
      where: { programId, isActive: true },
      orderBy: [{ creditType: "asc" }, { version: "desc" }],
    });
  }

  async exchangeRequests(
    programId: string,
    input: { memberId?: string; status?: string; page?: number; pageSize?: number } = {},
  ) {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 50;
    const where = {
      programId,
      ...(input.memberId ? { memberId: input.memberId } : {}),
      ...(input.status ? { status: input.status as "PENDING" | "APPROVED" | "PAID" | "CANCELLED" | "REJECTED" } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.creditExchangeRequest.findMany({
        where,
        include: { member: { select: { id: true, email: true, firstName: true, lastName: true } }, exchangeRate: true, transaction: true },
        orderBy: { requestedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.creditExchangeRequest.count({ where }),
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async approveExchange(programId: string, requestId: string, adminId: string) {
    const request = await this.db.creditExchangeRequest.findFirst({ where: { id: requestId, programId } });
    if (!request) throw new LoyaltyError("CREDIT_EXCHANGE_NOT_FOUND", 404);
    if (request.status !== "PENDING") throw new LoyaltyError("CREDIT_EXCHANGE_INVALID_STATUS", 409);
    return this.db.creditExchangeRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", approvedAt: new Date(), approvedBy: adminId },
    });
  }

  async fulfillExchange(programId: string, requestId: string, adminId: string) {
    const request = await this.db.creditExchangeRequest.findFirst({ where: { id: requestId, programId } });
    if (!request) throw new LoyaltyError("CREDIT_EXCHANGE_NOT_FOUND", 404);
    if (request.status !== "APPROVED" && request.status !== "PENDING") {
      throw new LoyaltyError("CREDIT_EXCHANGE_INVALID_STATUS", 409);
    }
    return this.db.creditExchangeRequest.update({
      where: { id: requestId },
      data: {
        status: "PAID",
        approvedAt: request.approvedAt ?? new Date(),
        approvedBy: request.approvedBy ?? adminId,
        fulfilledAt: new Date(),
        fulfilledBy: adminId,
      },
    });
  }

  async cancelExchange(programId: string, requestId: string, adminId: string, reason: string) {
    if (!reason.trim()) throw new LoyaltyError("CREDIT_REASON_REQUIRED", 400);
    return this.db.$transaction(async (tx) => {
      const request = await tx.creditExchangeRequest.findFirst({
        where: { id: requestId, programId },
        include: { transaction: true },
      });
      if (!request) throw new LoyaltyError("CREDIT_EXCHANGE_NOT_FOUND", 404);
      if (request.status === "CANCELLED") return request;
      if (request.status === "PAID") throw new LoyaltyError("CREDIT_EXCHANGE_ALREADY_PAID", 409);

      if (request.transaction) {
        await this.creditWallet(tx, {
          memberId: request.memberId,
          programId,
          creditType: request.creditType,
          amount: request.amount,
          type: "REVERSAL",
          source: "exchange:cancelled",
          reason,
          idempotencyKey: `credit-exchange-cancel:${request.id}`,
          actorType: "ADMIN_USER",
          actorId: adminId,
          metadata: { exchangeRequestId: request.id, originalTransactionId: request.transaction.id },
        });
      }

      return tx.creditExchangeRequest.update({
        where: { id: request.id },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: adminId, cancellationReason: reason },
      });
    });
  }

  async openBankCycle(programId: string, adminId: string) {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.creditBankCycle.findFirst({ where: { programId, status: "OPEN" } });
      if (existing) return existing;
      const program = await tx.program.findUnique({ where: { id: programId }, select: { creditBankCycleDays: true } });
      const now = new Date();
      const end = new Date(now.getTime() + (program?.creditBankCycleDays ?? 30) * 24 * 60 * 60 * 1000);
      const banks = await tx.creditBank.findMany({ where: { programId } });
      return tx.creditBankCycle.create({
        data: {
          programId,
          startsAt: now,
          endsAt: end,
          openingP: banks.find((bank) => bank.creditType === "P")?.balance ?? 0,
          openingR: banks.find((bank) => bank.creditType === "R")?.balance ?? 0,
          clearedBy: adminId,
        },
      });
    });
  }

  async clearBankCycle(programId: string, cycleId: string, adminId: string, reason: string) {
    if (!reason.trim()) throw new LoyaltyError("CREDIT_REASON_REQUIRED", 400);
    return this.db.$transaction(async (tx) => {
      const cycle = await tx.creditBankCycle.findFirst({ where: { id: cycleId, programId } });
      if (!cycle) throw new LoyaltyError("CREDIT_BANK_CYCLE_NOT_FOUND", 404);
      if (cycle.status === "CLEARED") return cycle;
      const banks = await tx.creditBank.findMany({ where: { programId } });
      const balances = { P: 0, R: 0 } as Record<CreditKind, number>;
      for (const bank of banks) {
        const amount = bank.balance;
        balances[bank.creditType] = amount;
        if (amount > 0) {
          await tx.creditBank.update({ where: { id: bank.id }, data: { balance: 0 } });
          await tx.creditBankTransaction.create({
            data: {
              bankId: bank.id,
              programId,
              creditType: bank.creditType,
              amount: -amount,
              balanceAfter: 0,
              type: "CYCLE_CLEAR",
              reason,
              actorId: adminId,
              cycleId,
              idempotencyKey: `credit-bank-clear:${cycleId}:${bank.creditType}`,
            },
          });
        }
      }
      return tx.creditBankCycle.update({
        where: { id: cycleId },
        data: { status: "CLEARED", closingP: balances.P, closingR: balances.R, clearedAt: new Date(), clearedBy: adminId, note: reason },
      });
    });
  }

  async adminAdjust(
    programId: string,
    adminId: string,
    input: { memberId: string; creditType: CreditKind; amount: number; reason: string; idempotencyKey: string; expiresAt?: Date; categoryId?: string },
  ) {
    if (!Number.isInteger(input.amount) || input.amount === 0) {
      throw new LoyaltyError("CREDIT_AMOUNT_INVALID", 400);
    }
    if (!input.reason.trim()) throw new LoyaltyError("CREDIT_REASON_REQUIRED", 400);
    if (input.amount > 0 && input.creditType === "P" && !input.expiresAt) {
      throw new LoyaltyError("P_CREDIT_EXPIRY_REQUIRED", 400);
    }

    return this.db.$transaction(async (tx) => {
      const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;

      const member = await tx.member.findFirst({ where: { id: input.memberId, programId, deletedAt: null, status: "ACTIVE" } });
      if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
      if (input.categoryId) {
        const category = await tx.creditCategory.findFirst({ where: { id: input.categoryId, programId, isActive: true } });
        if (!category) throw new LoyaltyError("CREDIT_CATEGORY_NOT_FOUND", 404);
      }

      let memberTransaction;
      if (input.amount > 0) {
        const bank = await this.ensureBank(tx, programId, input.creditType);
        const updatedBank = await tx.creditBank.updateMany({
          where: { id: bank.id, balance: { gte: input.amount } },
          data: { balance: { decrement: input.amount } },
        });
        if (updatedBank.count !== 1) throw new LoyaltyError("CREDIT_BANK_INSUFFICIENT", 422);
        const currentBank = await tx.creditBank.findUniqueOrThrow({ where: { id: bank.id } });
        await tx.creditBankTransaction.create({
          data: {
            bankId: bank.id,
            programId,
            creditType: input.creditType as CreditType,
            amount: -input.amount,
            balanceAfter: currentBank.balance,
            type: "ALLOCATION",
            reason: input.reason,
            actorId: adminId,
            idempotencyKey: `${input.idempotencyKey}:bank`,
          },
        });
        memberTransaction = await this.creditWallet(tx, {
          memberId: input.memberId,
          programId,
          creditType: input.creditType,
          amount: input.amount,
          type: "ADJUSTMENT",
          source: `admin:${adminId}`,
          reason: input.reason,
          categoryId: input.categoryId,
          actorType: "ADMIN_USER",
          actorId: adminId,
          expiresAt: input.creditType === "P" ? input.expiresAt : undefined,
          idempotencyKey: input.idempotencyKey,
        });
      } else {
        memberTransaction = await this.debitWallet(tx, {
          memberId: input.memberId,
          programId,
          creditType: input.creditType,
          amount: Math.abs(input.amount),
          type: "ADJUSTMENT",
          source: `admin:${adminId}`,
          reason: input.reason,
          categoryId: input.categoryId,
          actorType: "ADMIN_USER",
          actorId: adminId,
          idempotencyKey: input.idempotencyKey,
        });
        const bank = await this.ensureBank(tx, programId, input.creditType);
        const updatedBank = await tx.creditBank.update({ where: { id: bank.id }, data: { balance: { increment: Math.abs(input.amount) } } });
        await tx.creditBankTransaction.create({
          data: {
            bankId: bank.id,
            programId,
            creditType: input.creditType as CreditType,
            amount: Math.abs(input.amount),
            balanceAfter: updatedBank.balance,
            type: "RETURN",
            reason: input.reason,
            actorId: adminId,
            idempotencyKey: `${input.idempotencyKey}:bank`,
          },
        });
      }
      return memberTransaction;
    });
  }

  async issueToBank(
    programId: string,
    adminId: string,
    input: { creditType: CreditKind; amount: number; reason: string; idempotencyKey: string },
  ) {
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw new LoyaltyError("CREDIT_AMOUNT_INVALID", 400);
    if (!input.reason.trim()) throw new LoyaltyError("CREDIT_REASON_REQUIRED", 400);
    return this.db.$transaction(async (tx) => {
      const existing = await tx.creditBankTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return existing;
      const bank = await this.ensureBank(tx, programId, input.creditType);
      const updated = await tx.creditBank.update({ where: { id: bank.id }, data: { balance: { increment: input.amount } } });
      return tx.creditBankTransaction.create({
        data: {
          bankId: bank.id,
          programId,
          creditType: input.creditType as CreditType,
          amount: input.amount,
          balanceAfter: updated.balance,
          type: "ISSUANCE",
          reason: input.reason,
          actorId: adminId,
          idempotencyKey: input.idempotencyKey,
        },
      });
    });
  }

  async bank(programId: string) {
    const banks = await this.db.creditBank.findMany({ where: { programId }, orderBy: { creditType: "asc" } });
    const byType = new Map(banks.map((bank) => [asKind(bank.creditType), bank]));
    return (["P", "R"] as CreditKind[]).map((creditType) => ({
      creditType,
      balance: byType.get(creditType)?.balance ?? 0,
    }));
  }

  async expire(programId: string): Promise<number> {
    const candidates = await this.db.creditLot.findMany({
      where: { programId, creditType: "P", remainingAmount: { gt: 0 }, expiresAt: { lte: new Date() } },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    });
    let expired = 0;
    for (const candidate of candidates) {
      const result = await this.db.$transaction(async (tx) => {
        const idempotencyKey = `credit-expire:${candidate.id}:${candidate.remainingAmount}`;
        const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey } });
        if (existing) return false;
        const wallet = await tx.creditWallet.findUniqueOrThrow({ where: { id: candidate.walletId } });
        const amount = Math.min(candidate.remainingAmount, wallet.balance);
        if (amount <= 0) return false;
        await tx.creditLot.update({ where: { id: candidate.id }, data: { remainingAmount: { decrement: amount } } });
        await tx.creditWallet.update({ where: { id: wallet.id }, data: { balance: { decrement: amount }, totalSpent: { increment: amount } } });
        const after = await tx.creditWallet.findUniqueOrThrow({ where: { id: wallet.id } });
        await tx.creditTransaction.create({
          data: {
            walletId: wallet.id,
            memberId: candidate.memberId,
            programId,
            creditType: "P",
            type: "EXPIRATION",
            amount: -amount,
            balanceAfter: after.balance,
            source: "system:expiration",
            reason: `Expired grant ${candidate.grantTransactionId}`,
            idempotencyKey,
            actorType: "SYSTEM",
            actorId: "credit-expiration",
            metadata: { sourceTransactionId: candidate.grantTransactionId, lotId: candidate.id },
          },
        });
        return true;
      });
      if (result) expired++;
    }
    return expired;
  }

  async expiringNotices(programId: string) {
    const program = await this.db.program.findUnique({ where: { id: programId }, select: { creditExpiryWarningDays: true } });
    const warningDays = program?.creditExpiryWarningDays ?? [30, 7];
    const now = new Date();
    const horizon = new Date(now.getTime() + Math.max(...warningDays, 0) * 24 * 60 * 60 * 1000);
    const lots = await this.db.creditLot.findMany({
      where: { programId, creditType: "P", remainingAmount: { gt: 0 }, expiresAt: { gt: now, lte: horizon }, member: { status: "ACTIVE" } },
      include: { member: { select: { id: true, email: true, firstName: true, lastName: true, locale: true } } },
    });
    const notices: Array<{ memberId: string; amount: number; expiresAt: Date; days: number; member: { id: string; email: string | null; firstName: string | null; lastName: string | null; locale: string | null } }> = [];
    for (const lot of lots) {
      if (!lot.expiresAt) continue;
      const days = Math.ceil((lot.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      const warning = warningDays.find((value) => value >= days && !lot.warningDaysSent.includes(value));
      if (warning == null) continue;
      await this.db.creditLot.update({ where: { id: lot.id }, data: { warningDaysSent: { push: warning } } });
      notices.push({ memberId: lot.memberId, amount: lot.remainingAmount, expiresAt: lot.expiresAt, days: warning, member: lot.member });
    }
    return notices;
  }

  async redeem(
    memberId: string,
    programId: string,
    input: { creditType: CreditKind; amount: number; source: string; idempotencyKey: string; metadata?: Record<string, unknown> },
  ) {
    return this.db.$transaction((tx) =>
      this.debitWallet(tx, {
        memberId,
        programId,
        creditType: input.creditType,
        amount: input.amount,
        type: "REDEEM",
        source: input.source,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      }),
    );
  }

  async redeemReward(
    rewardId: string,
    memberId: string,
    programId: string,
    input: { creditType: CreditKind; idempotencyKey: string },
  ) {
    return this.db.$transaction(async (tx) => {
      const reward = await tx.reward.findFirst({ where: { id: rewardId, programId, deletedAt: null } });
      if (!reward || !reward.isActive) throw new LoyaltyError("REWARD_NOT_ACTIVE", 409);
      const member = await tx.member.findFirst({ where: { id: memberId, programId, deletedAt: null, status: "ACTIVE" } });
      if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);

      const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return { transactionId: existing.id, redemptionId: null, amount: Math.abs(existing.amount), idempotent: true };

      if (reward.tierRequired) {
        const memberTier = await tx.memberTier.findFirst({ where: { memberId, downgradedAt: null }, include: { tier: true } });
        const requiredTier = await tx.tier.findFirst({ where: { programId, name: reward.tierRequired } });
        if (!requiredTier || !memberTier || memberTier.tier.rank < requiredTier.rank) {
          throw new LoyaltyError("REWARD_TIER_INSUFFICIENT", 422);
        }
      }
      if (reward.stock != null) {
        const stock = await tx.reward.updateMany({ where: { id: rewardId, stock: { gt: 0 } }, data: { stock: { decrement: 1 } } });
        if (stock.count !== 1) throw new LoyaltyError("REWARD_OUT_OF_STOCK", 409);
      }

      const transaction = await this.debitWallet(tx, {
        memberId,
        programId,
        creditType: input.creditType,
        amount: reward.pointsCost,
        type: "REDEEM",
        source: `reward:${rewardId}`,
        reason: `Reward redemption: ${reward.name}`,
        actorType: "MEMBER",
        actorId: memberId,
        idempotencyKey: input.idempotencyKey,
        metadata: { rewardId, creditType: input.creditType },
      });
      const redemption = await tx.rewardRedemption.create({
        data: {
          rewardId,
          memberId,
          pointsSpent: reward.pointsCost,
          metadata: { idempotencyKey: input.idempotencyKey, creditType: input.creditType },
        },
      });
      return { transactionId: transaction.id, redemptionId: redemption.id, amount: reward.pointsCost, idempotent: false };
    });
  }

  async clearMemberBalances(programId: string, memberId: string, adminId: string, reason: string) {
    if (!reason.trim()) throw new LoyaltyError("CREDIT_REASON_REQUIRED", 400);
    return this.db.$transaction(async (tx) => {
      const member = await tx.member.findFirst({ where: { id: memberId, programId } });
      if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
      const wallets = await tx.creditWallet.findMany({ where: { memberId, programId, balance: { gt: 0 } } });
      const transactions = [];
      for (const wallet of wallets) {
        transactions.push(
          await this.debitWallet(tx, {
            memberId,
            programId,
            creditType: wallet.creditType,
            amount: wallet.balance,
            type: "CLEARANCE",
            source: "system:offboarding",
            reason,
            idempotencyKey: `credit-clearance:${memberId}:${wallet.creditType}`,
            actorType: "ADMIN_USER",
            actorId: adminId,
          }),
        );
      }
      await tx.member.update({ where: { id: memberId }, data: { status: "INACTIVE", deactivatedAt: new Date(), deletedAt: new Date() } });
      return transactions;
    });
  }

  async reactivateMember(programId: string, memberId: string) {
    const member = await this.db.member.findFirst({ where: { id: memberId, programId } });
    if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
    return this.db.member.update({
      where: { id: memberId },
      data: { status: "ACTIVE", deactivatedAt: null, deletedAt: null },
    });
  }

  private async ensureBank(tx: Prisma.TransactionClient, programId: string, creditType: CreditKind) {
    return tx.creditBank.upsert({
      where: { programId_creditType: { programId, creditType: creditType as CreditType } },
      create: { programId, creditType: creditType as CreditType },
      update: {},
    });
  }

  private async ensureWallet(tx: Prisma.TransactionClient, memberId: string, programId: string, creditType: CreditKind) {
    return tx.creditWallet.upsert({
      where: { memberId_creditType: { memberId, creditType: creditType as CreditType } },
      create: { memberId, programId, creditType: creditType as CreditType },
      update: {},
    });
  }

  private async creditWallet(
    tx: Prisma.TransactionClient,
    input: {
      memberId: string;
      programId: string;
      creditType: CreditKind;
      amount: number;
      type: CreditTransactionType;
      source: string;
      idempotencyKey: string;
      reason?: string;
      message?: string;
      category?: string;
      categoryId?: string;
      sourceCreditType?: CreditKind;
      receivedCreditType?: CreditKind;
      counterpartyMemberId?: string;
      exchangeRateId?: string;
      exchangeRequestId?: string;
      actorType?: string;
      actorId?: string;
      metadata?: Record<string, unknown>;
      expiresAt?: Date;
    },
  ) {
    const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
    const wallet = await this.ensureWallet(tx, input.memberId, input.programId, input.creditType);
    const updated = await tx.creditWallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: input.amount }, totalGranted: { increment: input.amount } },
    });
    const previous = await tx.creditTransaction.findFirst({
      where: { programId: input.programId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { recordHash: true },
    });
    const recordHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({
        programId: input.programId,
        memberId: input.memberId,
        creditType: input.creditType,
        type: input.type,
        amount: input.amount,
        balanceAfter: updated.balance,
        source: input.source,
        idempotencyKey: input.idempotencyKey,
        previousHash: previous?.recordHash ?? null,
      }))
      .digest("hex");
    const transaction = await tx.creditTransaction.create({
      data: {
        walletId: wallet.id,
        memberId: input.memberId,
        programId: input.programId,
        creditType: input.creditType as CreditType,
        type: input.type,
        amount: input.amount,
        balanceAfter: updated.balance,
        source: input.source,
        reason: input.reason,
        message: input.message,
        category: input.category,
        categoryId: input.categoryId,
        sourceCreditType: input.sourceCreditType,
        receivedCreditType: input.receivedCreditType,
        counterpartyMemberId: input.counterpartyMemberId,
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
        exchangeRateId: input.exchangeRateId,
        exchangeRequestId: input.exchangeRequestId,
        actorType: input.actorType,
        actorId: input.actorId,
        previousHash: previous?.recordHash,
        recordHash,
        metadata: jsonValue(input.metadata),
      },
    });
    if (input.amount > 0) {
      await tx.creditLot.create({
        data: {
          grantTransactionId: transaction.id,
          walletId: wallet.id,
          memberId: input.memberId,
          programId: input.programId,
          creditType: input.creditType as CreditType,
          originalAmount: input.amount,
          remainingAmount: input.amount,
          expiresAt: input.expiresAt,
        },
      });
    }
    return { ...transaction, balanceBefore: wallet.balance };
  }

  private async debitWallet(
    tx: Prisma.TransactionClient,
    input: {
      memberId: string;
      programId: string;
      creditType: CreditKind;
      amount: number;
      type: CreditTransactionType;
      source: string;
      idempotencyKey: string;
      reason?: string;
      message?: string;
      category?: string;
      categoryId?: string;
      sourceCreditType?: CreditKind;
      receivedCreditType?: CreditKind;
      counterpartyMemberId?: string;
      exchangeRateId?: string;
      exchangeRequestId?: string;
      actorType?: string;
      actorId?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
    const wallet = await this.ensureWallet(tx, input.memberId, input.programId, input.creditType);
    if (input.creditType === "P") {
      const lots = await tx.creditLot.findMany({
        where: { walletId: wallet.id, remainingAmount: { gt: 0 } },
        orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
      });
      let remaining = input.amount;
      for (const lot of lots) {
        if (remaining <= 0) break;
        const consumed = Math.min(remaining, lot.remainingAmount);
        await tx.creditLot.update({ where: { id: lot.id }, data: { remainingAmount: { decrement: consumed } } });
        remaining -= consumed;
      }
      // Existing installations may have P-credit rows created before lots were
      // introduced. The wallet balance check below remains the compatibility fallback.
    }
    const updatedCount = await tx.creditWallet.updateMany({
      where: { id: wallet.id, balance: { gte: input.amount } },
      data: { balance: { decrement: input.amount }, totalSpent: { increment: input.amount } },
    });
    if (updatedCount.count !== 1) throw new LoyaltyError("CREDIT_INSUFFICIENT_BALANCE", 422);
    const updated = await tx.creditWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    const previous = await tx.creditTransaction.findFirst({
      where: { programId: input.programId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { recordHash: true },
    });
    const recordHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({
        programId: input.programId,
        memberId: input.memberId,
        creditType: input.creditType,
        type: input.type,
        amount: -input.amount,
        balanceAfter: updated.balance,
        source: input.source,
        idempotencyKey: input.idempotencyKey,
        previousHash: previous?.recordHash ?? null,
      }))
      .digest("hex");
    const transaction = await tx.creditTransaction.create({
      data: {
        walletId: wallet.id,
        memberId: input.memberId,
        programId: input.programId,
        creditType: input.creditType as CreditType,
        type: input.type,
        amount: -input.amount,
        balanceAfter: updated.balance,
        source: input.source,
        reason: input.reason,
        message: input.message,
        category: input.category,
        categoryId: input.categoryId,
        sourceCreditType: input.sourceCreditType,
        receivedCreditType: input.receivedCreditType,
        counterpartyMemberId: input.counterpartyMemberId,
        idempotencyKey: input.idempotencyKey,
        exchangeRateId: input.exchangeRateId,
        exchangeRequestId: input.exchangeRequestId,
        actorType: input.actorType,
        actorId: input.actorId,
        previousHash: previous?.recordHash,
        recordHash,
        metadata: jsonValue(input.metadata),
      },
    });
    return { ...transaction, balanceBefore: wallet.balance };
  }
}

export const creditService = new CreditService();
