import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { notifyApprovalAssignees, notifyDirectExchangeApprovers } from "../lib/admin-notifications.js";
import { audit } from "../lib/audit.js";
import { createdByForEntities } from "../lib/created-by.js";
import { LoyaltyError } from "../lib/errors.js";
import { notificationsService } from "../lib/notifications-setup.js";
import { requireCapability } from "../lib/permissions.js";
import { BANK_CYCLE_RETURN_TYPES, clearCycleBank, closeExpiredBankCycle, walletService } from "../lib/wallets.js";
import { notifyCreditAdjustment, notifyCreditExchangeDecision } from "../lib/member-notifications.js";

function idempotencyKey(request: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 8)
    throw new LoyaltyError("MISSING_IDEMPOTENCY_KEY", 400);
  return value;
}

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

function bankCycleAllocationWhere(
  cycleId: string,
  from?: Date | null,
  through?: Date | null,
): Prisma.PointBankTransactionWhereInput {
  return {
    cycleId,
    ...(from || through
      ? { createdAt: { ...(from ? { gte: from } : {}), ...(through ? { lte: through } : {}) } }
      : {}),
    OR: [
      { amount: { lt: 0 }, type: { not: "CYCLE_CLEAR" } },
      { type: { in: [...BANK_CYCLE_RETURN_TYPES] }, amount: { gt: 0 } },
    ],
  };
}

function netBankCycleAllocated(transactionTotal: number | null, fallback: number): number {
  return transactionTotal === null ? fallback : Math.max(0, -transactionTotal);
}

const exchangeStatusSchema = z.enum(["PENDING", "APPROVED", "COMPLETED", "CANCELLED", "REJECTED"]);

async function clearDirectExchangeNotifications(programId: string, voucherId: string): Promise<void> {
  await prisma.adminNotification.updateMany({
    where: {
      programId,
      triggerEvent: "admin.exchange.pending",
      entityType: "PointExchangeRequest",
      entityId: voucherId,
      readAt: null,
    },
    data: { readAt: new Date() },
  });
}

async function memberLocale(memberId: string, programId: string): Promise<string> {
  const member = await prisma.member.findFirst({
    where: { id: memberId, programId },
    select: { locale: true, program: { select: { defaultLocale: true } } },
  });
  return member?.locale ?? member?.program.defaultLocale ?? "en-US";
}

interface BankCycleActor {
  id: string;
  name: string;
  email: string | null;
  type: "ADMIN_USER" | "MEMBER" | "API_KEY" | "SYSTEM" | "AUTOMATION" | "EXTERNAL";
}

async function resolveBankCycleActors(
  programId: string,
  rawActorIds: string[],
): Promise<Map<string, BankCycleActor>> {
  const actorIds = [...new Set(rawActorIds.filter(Boolean))];
  if (actorIds.length === 0) return new Map();
  const lookupIds = [...new Set([
    ...actorIds,
    ...actorIds.flatMap((id) => id.startsWith("admin:") ? [id.slice("admin:".length)] : []),
  ])];
  const [admins, members, apiKeys] = await Promise.all([
    prisma.adminUser.findMany({
      where: { programId, id: { in: lookupIds } },
      select: { id: true, name: true, email: true },
    }),
    prisma.member.findMany({
      where: { programId, id: { in: lookupIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    }),
    prisma.apiKey.findMany({ where: { programId, id: { in: lookupIds } }, select: { id: true, name: true } }),
  ]);
  const adminById = new Map(admins.map((admin) => [admin.id, admin]));
  const memberById = new Map(members.map((member) => [member.id, member]));
  const resolved = new Map<string, BankCycleActor>();
  for (const rawId of actorIds) {
    const normalizedId = rawId.startsWith("admin:") ? rawId.slice("admin:".length) : rawId;
    const admin = adminById.get(normalizedId);
    if (admin) {
      resolved.set(rawId, { ...admin, type: "ADMIN_USER" });
      continue;
    }
    const member = memberById.get(normalizedId);
    if (member) {
      const fullName = [member.firstName, member.lastName].filter(Boolean).join(" ");
      resolved.set(rawId, { id: member.id, name: fullName || member.email || "Member", email: member.email, type: "MEMBER" });
      continue;
    }
    const apiKey = apiKeys.find((key) => key.id === normalizedId);
    if (apiKey) {
      resolved.set(rawId, { ...apiKey, name: apiKey.name ?? "API key", email: null, type: "API_KEY" });
      continue;
    }
    if (rawId === "system" || rawId.startsWith("system:")) {
      resolved.set(rawId, { id: rawId, name: "System", email: null, type: "SYSTEM" });
      continue;
    }
    if (rawId.startsWith("campaign:")) {
      resolved.set(rawId, { id: rawId, name: "Campaign automation", email: null, type: "AUTOMATION" });
      continue;
    }
    resolved.set(rawId, { id: rawId, name: "Integration / external actor", email: null, type: "EXTERNAL" });
  }
  return resolved;
}

export function creditsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  // Compatibility name retained; payload is now fully dynamic.
  app.get(
    "/admin/credits/config",
    { preHandler: [requireCapability("point_type.view")] },
    async (request, reply) => {
      return reply.send({
        data: {
          pointTypes: await walletService.pointTypes(request.programId, true),
          note: "Credit behavior is configured per point type.",
        },
      });
    },
  );

  app.get("/members/me/credits", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    return reply.send({
      data: await walletService.memberWallets(request.memberId, request.programId),
    });
  });

  app.get("/members/me/credits/summary", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const query = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() }).parse(request.query);
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from > to) throw new LoyaltyError("INVALID_DATE_RANGE", 400);
    const wallets = await walletService.memberWallets(request.memberId, request.programId, false, true);
    const pointTypeIds = wallets.map((wallet) => wallet.pointTypeId);
    const where: Prisma.CustomPointTransactionWhereInput = {
      programId: request.programId,
      memberId: request.memberId,
      pointTypeId: { in: pointTypeIds },
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    // A balance is a snapshot: take the last wallet ledger entry before each boundary.
    const balancesAt = (boundary: Date, inclusive: boolean) => prisma.$queryRaw<Array<{ pointTypeId: string; balanceAfter: number }>>(Prisma.sql`
      SELECT DISTINCT ON ("pointTypeId") "pointTypeId", "balanceAfter"
      FROM "CustomPointTransaction"
      WHERE "programId" = ${request.programId} AND "memberId" = ${request.memberId}
        AND "createdAt" ${inclusive ? Prisma.sql`<=` : Prisma.sql`<`} ${boundary}
      ORDER BY "pointTypeId", "createdAt" DESC, "id" DESC
    `);
    const [groups, allowances, expirations, openingRows, endingRows] = await Promise.all([
      prisma.customPointTransaction.groupBy({ by: ["pointTypeId", "action"], where, _sum: { amount: true } }),
      prisma.customPointTransaction.findMany({ where: { ...where, action: "GIVE_ALLOWANCE_OUT" }, select: { pointTypeId: true, metadata: true } }),
      prisma.$queryRaw<Array<{ pointTypeId: string; expired: bigint }>>(Prisma.sql`
        SELECT expiration."pointTypeId", COALESCE(SUM(-expiration."amount"), 0)::bigint AS expired
        FROM "CustomPointTransaction" AS expiration
        WHERE expiration."programId" = ${request.programId}
          AND expiration."memberId" = ${request.memberId}
          AND expiration."action" = 'EXPIRATION'
          AND expiration."amount" < 0
          ${from ? Prisma.sql`AND expiration."createdAt" >= ${from}` : Prisma.empty}
          ${to ? Prisma.sql`AND expiration."createdAt" <= ${to}` : Prisma.empty}
          AND NOT EXISTS (
            SELECT 1 FROM "CustomPointTransaction" AS reset
            WHERE reset."programId" = expiration."programId"
              AND reset."memberId" = expiration."memberId"
              AND reset."pointTypeId" = expiration."pointTypeId"
              AND reset."action" = 'EXPIRATION_RESET'
              AND reset."reversedFromId" = expiration."id"
              ${to ? Prisma.sql`AND reset."createdAt" <= ${to}` : Prisma.empty}
          )
        GROUP BY expiration."pointTypeId"
      `),
      from ? balancesAt(from, false) : Promise.resolve([]),
      to ? balancesAt(to, true) : Promise.resolve([]),
    ]);
    const totals = new Map(pointTypeIds.map((id) => [id, { received: 0, sent: 0, redeemed: 0, expired: 0 }]));
    for (const group of groups) {
      const total = totals.get(group.pointTypeId);
      if (!total) continue;
      const amount = group._sum.amount ?? 0;
      if (["EARN", "GRANT", "GIVE_IN"].includes(group.action)) total.received += Math.max(0, amount);
      if (group.action === "GIVE_OUT") total.sent += Math.max(0, -amount);
      if (["REDEEM", "EXCHANGE"].includes(group.action)) total.redeemed += Math.max(0, -amount);
    }
    for (const entry of expirations) {
      const total = totals.get(entry.pointTypeId);
      if (total) total.expired = Number(entry.expired);
    }
    for (const entry of allowances) {
      const metadata = entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata) ? entry.metadata : {};
      const spent = Number(metadata.allowanceSpent ?? 0);
      if (Number.isFinite(spent) && spent > 0) totals.get(entry.pointTypeId)!.sent += spent;
    }
    const openingByType = new Map(openingRows.map((row) => [row.pointTypeId, row.balanceAfter]));
    const endingByType = new Map(endingRows.map((row) => [row.pointTypeId, row.balanceAfter]));
    return reply.send({ data: wallets.map((wallet) => ({
      ...wallet,
      openingBalance: from ? openingByType.get(wallet.pointTypeId) ?? 0 : null,
      periodEndBalance: to ? endingByType.get(wallet.pointTypeId) ?? 0 : wallet.balance,
      ...totals.get(wallet.pointTypeId),
    })) });
  });

  app.get("/members/me/credits/transactions", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const query = pageSchema
      .extend({
        pointTypeId: z.string().optional(),
        action: z.string().optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      })
      .parse(request.query);
    return reply.send({
      data: await walletService.history(request.programId, {
        memberId: request.memberId,
        pointTypeId: query.pointTypeId,
        action: query.action,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        page: query.page,
        pageSize: query.pageSize,
      }),
    });
  });

  app.get("/members/me/recognition-feed", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const query = pageSchema
      .extend({
        kind: z.enum(["all", "received", "given"]).default("all"),
        pointTypeId: z.string().optional(),
        categoryId: z.string().optional(),
      })
      .parse(request.query);
    const actions =
      query.kind === "received"
        ? ["GIVE_IN"]
        : query.kind === "given"
          ? ["GIVE_OUT", "GIVE_ALLOWANCE_OUT"]
          : ["GIVE_IN", "GIVE_OUT", "GIVE_ALLOWANCE_OUT"];
    const selfFilter: Prisma.CustomPointTransactionWhereInput = {
      memberId: request.memberId,
      action: { in: actions },
    };
    const where: Prisma.CustomPointTransactionWhereInput = {
      programId: request.programId,
      ...selfFilter,
      ...(query.pointTypeId ? { pointTypeId: query.pointTypeId } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.customPointTransaction.findMany({
        where,
        include: {
          pointType: {
            select: { id: true, code: true, name: true, unitLabel: true, color: true },
          },
          member: { select: { id: true, firstName: true, lastName: true, email: true } },
          counterparty: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          categoryRef: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.customPointTransaction.count({ where }),
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
  });

  app.get("/credits/categories", async (request, reply) => {
    const categories = await prisma.creditCategory.findMany({
      where: { programId: request.programId, isActive: true },
      orderBy: { name: "asc" },
    });
    return reply.send({ data: categories });
  });

  app.get("/credits/exchange/rates", async (request, reply) => {
    return reply.send({ data: await walletService.exchangeRates(request.programId) });
  });

  app.get("/members/me/credits/exchange-requests", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const query = pageSchema.parse(request.query);
    return reply.send({
      data: await walletService.exchangeRequests(request.programId, {
        memberId: request.memberId,
        page: query.page,
        pageSize: query.pageSize,
      }),
    });
  });

  app.post(
    "/credits/give",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
      const body = z
        .object({
          sourcePointTypeId: z.string().min(1),
          destinationPointTypeId: z.string().min(1),
          recipients: z
            .array(
              z.object({
                memberId: z.string().min(1),
                amount: z.number().int().positive(),
                message: z.string().trim().max(500).optional(),
              }),
            )
            .min(1)
            .max(500),
          message: z.string().trim().max(500).optional(),
          category: z.string().trim().max(80).optional(),
          categoryId: z.string().min(1).optional(),
        })
        .parse(request.body);
      if (body.categoryId) {
        const category = await prisma.creditCategory.findFirst({
          where: { id: body.categoryId, programId: request.programId, isActive: true },
        });
        if (!category) throw new LoyaltyError("POINT_CATEGORY_NOT_FOUND", 404);
      }
      const result = await walletService.give(request.memberId, request.programId, {
        ...body,
        idempotencyKey: idempotencyKey(request),
      });
      if (!result.idempotent) {
        await audit(
          request.programId,
          request.actor,
          "CREDIT_GIVE",
          "point_transfer",
          result.transactions[0]?.id ?? null,
          {
            sourcePointTypeId: body.sourcePointTypeId,
            destinationPointTypeId: body.destinationPointTypeId,
            recipients: body.recipients.map(({ memberId, amount }) => ({ memberId, amount })),
            transactionIds: result.transactions.map((transaction) => transaction.id),
          },
          body.message,
        );
        const recipientMembers = await prisma.member.findMany({
          where: {
            id: { in: body.recipients.map((recipient) => recipient.memberId) },
            programId: request.programId,
          },
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            locale: true,
          },
        });
        const destinationType = await prisma.pointTypeDefinition.findFirst({
          where: { id: body.destinationPointTypeId, programId: request.programId },
          select: { id: true, code: true, name: true, unitLabel: true },
        });
        await Promise.all(body.recipients.map(async (recipient) => {
          const member = recipientMembers.find((candidate) => candidate.id === recipient.memberId);
          const received = result.transactions.find(
            (transaction) =>
              transaction.action === "GIVE_IN" && transaction.memberId === recipient.memberId,
          );
          try {
            await notificationsService.sendTrigger(
              request.programId,
              "credit.received",
              recipient.memberId,
              {
                sourcePointTypeId: body.sourcePointTypeId,
                destinationPointTypeId: body.destinationPointTypeId,
                amount: received?.amount ?? recipient.amount,
                sourceAmount: recipient.amount,
                message: recipient.message ?? body.message,
                category: body.category,
                pointType: destinationType,
                member,
                _locale: member?.locale,
              },
            );
          } catch (error) {
            request.log.warn({ err: error, memberId: recipient.memberId }, "Failed to notify credit recipient");
          }
        }));
      }
      return reply.status(result.idempotent ? 200 : 201).send({ data: result });
    },
  );

  app.post(
    "/credits/exchange",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
      const body = z
        .object({
          pointTypeId: z.string().min(1),
          amount: z.number().int().positive(),
          payoutType: z.enum(["CASH", "NON_CASH"]),
        })
        .parse(request.body);
      const result = await walletService.exchange(request.memberId, request.programId, {
        ...body,
        idempotencyKey: idempotencyKey(request),
      });
      if (!result.idempotent) {
        await audit(
          request.programId,
          request.actor,
          "CREDIT_EXCHANGE",
          "point_exchange_request",
          result.request.id,
          {
            pointTypeId: body.pointTypeId,
            amount: body.amount,
            payoutType: body.payoutType,
            valueMinor: result.request.valueMinor,
            documentNumber: result.request.documentNumber,
            beforeBalance: result.transaction
              ? result.transaction.balanceAfter + Math.abs(result.transaction.amount)
              : null,
            afterBalance: result.transaction?.balanceAfter ?? null,
          },
        );
        const locale = await memberLocale(request.memberId, request.programId);
        await notificationsService.sendTrigger(
          request.programId,
          "credit.exchange",
          request.memberId,
          { amount: body.amount, status: result.request.status, _locale: locale },
        ).catch((error: unknown) => request.log.warn({ err: error, memberId: request.memberId }, "Failed to notify exchange request submission"));
        if (result.request.approvalRequestId) {
          await notifyApprovalAssignees(request.programId, result.request.approvalRequestId).catch((error: unknown) =>
            request.log.warn({ err: error, approvalRequestId: result.request.approvalRequestId }, "Failed to notify exchange approvers"),
          );
        } else {
          await notifyDirectExchangeApprovers(request.programId, result.request.id, result.request.documentNumber).catch((error: unknown) =>
            request.log.warn({ err: error, voucherId: result.request.id }, "Failed to notify direct exchange approvers"),
          );
        }
      }
      return reply.status(result.idempotent ? 200 : 201).send({ data: result });
    },
  );

  app.get(
    "/admin/credits/bank",
    { preHandler: [requireCapability("bank.view")] },
    async (request, reply) => {
      return reply.send({ data: await walletService.banks(request.programId) });
    },
  );

  app.post(
    "/admin/credits/bank/issue",
    { preHandler: [requireCapability("bank.manage")] },
    async (request, reply) => {
      const body = z
        .object({
          pointTypeId: z.string().min(1),
          amount: z.number().int().positive(),
          reason: z.string().trim().min(1).max(500),
        })
        .parse(request.body);
      const result = await walletService.issueBank(
        request.programId,
        { pointTypeId: body.pointTypeId },
        body.amount,
        body.reason,
        request.actor,
        idempotencyKey(request),
      );
      await audit(
        request.programId,
        request.actor,
        "CREDIT_BANK",
        "point_bank_transaction",
        result.id,
        { ...body, balanceAfter: result.balanceAfter },
        body.reason,
      );
      return reply.status(201).send({ data: result });
    },
  );

  app.get(
    "/admin/credits/bank/transactions",
    { preHandler: [requireCapability("bank.view")] },
    async (request, reply) => {
      const query = pageSchema
        .extend({
          pointTypeId: z.string().optional(),
          type: z.string().trim().min(1).max(80).optional(),
          direction: z.enum(["increase", "decrease"]).optional(),
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
        })
        .parse(request.query);
      const where: Prisma.PointBankTransactionWhereInput = {
        programId: request.programId,
        ...(query.pointTypeId ? { pointTypeId: query.pointTypeId } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.direction === "increase" ? { amount: { gt: 0 } } : {}),
        ...(query.direction === "decrease" ? { amount: { lt: 0 } } : {}),
        ...((query.from || query.to) ? { createdAt: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {}),
        } } : {}),
      };
      if (query.from && query.to && new Date(query.from) > new Date(query.to)) throw new LoyaltyError("INVALID_DATE_RANGE", 400);
      const [items, total] = await Promise.all([
        prisma.pointBankTransaction.findMany({
          where,
          include: {
            pointType: { select: { id: true, code: true, name: true, unitLabel: true } },
            cycle: { select: { id: true, startsAt: true, endsAt: true, status: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.pointBankTransaction.count({ where }),
      ]);
      const actors = await resolveBankCycleActors(request.programId, items.map((item) => item.actorId));
      return reply.send({
        data: {
          items: items.map((item) => ({ ...item, actor: actors.get(item.actorId) ?? null })),
          total,
          page: query.page,
          pageSize: query.pageSize,
          totalPages: Math.ceil(total / query.pageSize),
        },
      });
    },
  );

  app.post(
    "/admin/credits/adjust",
    { preHandler: [requireCapability("wallet.adjust")] },
    async (request, reply) => {
      const body = z
        .object({
          memberId: z.string().min(1),
          pointTypeId: z.string().min(1),
          amount: z
            .number()
            .int()
            .refine((value) => value !== 0),
          reason: z.string().trim().min(1).max(500),
        })
        .parse(request.body);
      const result = await walletService.adjust(
        request.programId,
        body.memberId,
        { pointTypeId: body.pointTypeId },
        body.amount,
        body.reason,
        request.actor,
        idempotencyKey(request),
      );
      await audit(
        request.programId,
        request.actor,
        "CREDIT_ADJUSTMENT",
        "point_wallet",
        result.id,
        {
          memberId: body.memberId,
          pointTypeId: body.pointTypeId,
          amount: body.amount,
          beforeBalance: result.balanceAfter - result.amount,
          afterBalance: result.balanceAfter,
        },
        body.reason,
      );
      await notifyCreditAdjustment(request.programId, body.memberId, body.pointTypeId, result.amount, body.reason);
      return reply.status(201).send({ data: result });
    },
  );

  app.get(
    "/admin/credits/member-search",
    { preHandler: [requireCapability("wallet.adjust")] },
    async (request, reply) => {
      const query = z.object({
        search: z.string().trim().min(2).max(120),
      }).parse(request.query);
      const members = await prisma.member.findMany({
        where: {
          programId: request.programId,
          status: "ACTIVE",
          deletedAt: null,
          OR: [
            { id: { contains: query.search, mode: "insensitive" } },
            { email: { contains: query.search, mode: "insensitive" } },
            { firstName: { contains: query.search, mode: "insensitive" } },
            { lastName: { contains: query.search, mode: "insensitive" } },
            { externalId: { contains: query.search, mode: "insensitive" } },
          ],
        },
        select: { id: true, email: true, firstName: true, lastName: true, department: true },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        take: 10,
      });
      return reply.send({ data: { items: members, total: members.length, page: 1, pageSize: 10, totalPages: members.length ? 1 : 0 } });
    },
  );

  app.get(
    "/admin/credits/transactions",
    { preHandler: [requireCapability("wallet.view")] },
    async (request, reply) => {
      const query = pageSchema
        .extend({
          memberId: z.string().optional(),
          pointTypeId: z.string().optional(),
          action: z.string().optional(),
          direction: z.enum(["increase", "decrease"]).optional(),
          counterpartyMemberId: z.string().optional(),
          member: z.string().trim().min(1).max(100).optional(),
          categoryId: z.string().optional(),
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
        })
        .parse(request.query);
      if (query.from && query.to && new Date(query.from) > new Date(query.to)) throw new LoyaltyError("INVALID_DATE_RANGE", 400);
      const matchedMembers = query.member ? await prisma.member.findMany({
        where: { programId: request.programId, OR: [
          { id: query.member }, { email: { contains: query.member, mode: "insensitive" } },
          { firstName: { contains: query.member, mode: "insensitive" } }, { lastName: { contains: query.member, mode: "insensitive" } },
        ] }, select: { id: true },
      }) : undefined;
      const history = await walletService.history(request.programId, {
          ...query,
          memberIds: matchedMembers?.map((member) => member.id),
          direction: query.direction,
          from: query.from ? new Date(query.from) : undefined,
          to: query.to ? new Date(query.to) : undefined,
        });
      const actors = await resolveBankCycleActors(request.programId, history.items.flatMap((item) => item.actorId ? [item.actorId] : []));
      const sourceIds = (prefix: string) => [...new Set(history.items.filter((item) => item.source.startsWith(prefix)).map((item) => item.source.slice(prefix.length)))];
      const projectIds = sourceIds("project:");
      const rewardIds = sourceIds("reward:");
      const [projects, rewards] = await Promise.all([
        projectIds.length ? prisma.project.findMany({ where: { programId: request.programId, id: { in: projectIds } }, select: { id: true, name: true } }) : [],
        rewardIds.length ? prisma.reward.findMany({ where: { programId: request.programId, id: { in: rewardIds } }, select: { id: true, name: true } }) : [],
      ]);
      const labels = new Map<string, string>([...projects.map((item) => [`project:${item.id}`, item.name] as const), ...rewards.map((item) => [`reward:${item.id}`, item.name] as const)]);
      return reply.send({ data: { ...history, items: history.items.map((item) => ({
        ...item, actor: item.actorId ? actors.get(item.actorId) ?? null : null,
        sourceLabel: labels.get(item.source) ?? ("sourceLabel" in item ? item.sourceLabel : undefined),
      })) } });
    },
  );

  app.post(
    "/admin/credits/expire",
    { preHandler: [requireCapability("wallet.adjust")] },
    async (request, reply) => {
      const body = z.object({
        pointTypeId: z.string().trim().min(1).optional(),
        force: z.boolean().optional().default(false),
      }).parse(request.body ?? {});
      const result = await walletService.expire(request.programId, request.actor, body.pointTypeId, body.force);
      await audit(
        request.programId,
        request.actor,
        "CREDIT_ADJUSTMENT",
        "point_expiration_run",
        result.runId,
        {
          operation: body.force ? "FORCE_EXPIRY" : "RUN_EXPIRY",
          pointTypeId: body.pointTypeId ?? null,
          expiredLots: result.expired,
          expiredPoints: result.expiredPoints,
          force: body.force,
          runId: result.runId,
        },
      );
      return reply.send({ data: result });
    },
  );

  app.post(
    "/admin/credits/expire/reset",
    { preHandler: [requireCapability("wallet.adjust")] },
    async (request, reply) => {
      const body = z
        .object({
          pointTypeId: z.string().trim().min(1).optional(),
          runId: z.string().trim().min(1).optional(),
        })
        .parse(request.body ?? {});
      const result = await walletService.resetExpiry(
        request.programId,
        request.actor,
        body.pointTypeId,
        body.runId,
      );
      await audit(
        request.programId,
        request.actor,
        "CREDIT_ADJUSTMENT",
        "point_expiration_run",
        result.runId,
        { restored: result.restored, runId: result.runId },
        `Reset expiration run ${result.runId}`,
      );
      return reply.send({ data: result });
    },
  );

  app.get(
    "/admin/credits/categories",
    { preHandler: [requireCapability("recognition.view")] },
    async (request, reply) => {
      const categories = await prisma.creditCategory.findMany({
          where: { programId: request.programId },
          orderBy: [{ isActive: "desc" }, { name: "asc" }],
        });
      const creators = await createdByForEntities(
        request.programId,
        "point_category",
        categories.map((category) => category.id),
      );
      return reply.send({
        data: categories.map((category) => ({
          ...category,
          createdBy: creators.get(category.id) ?? null,
        })),
      });
    },
  );

  app.post(
    "/admin/credits/categories",
    { preHandler: [requireCapability("recognition.manage")] },
    async (request, reply) => {
      const body = z
        .object({
          name: z.string().trim().min(1).max(80),
          description: z.string().trim().max(500).optional(),
        })
        .parse(request.body);
      const category = await prisma.creditCategory.create({
        data: { programId: request.programId, ...body },
      });
      await audit(
        request.programId,
        request.actor,
        "CONFIG_CHANGE",
        "point_category",
        category.id,
        { action: "CREATE", ...body },
      );
      return reply.status(201).send({ data: category });
    },
  );

  app.patch(
    "/admin/credits/categories/:id",
    { preHandler: [requireCapability("recognition.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z
        .object({
          name: z.string().trim().min(1).max(80).optional(),
          description: z.string().trim().max(500).nullable().optional(),
          isActive: z.boolean().optional(),
        })
        .parse(request.body);
      const changed = await prisma.creditCategory.updateMany({
        where: { id, programId: request.programId },
        data: body,
      });
      if (changed.count !== 1) throw new LoyaltyError("POINT_CATEGORY_NOT_FOUND", 404);
      const category = await prisma.creditCategory.findUniqueOrThrow({ where: { id } });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "point_category", id, {
        action: "UPDATE",
        ...body,
      });
      return reply.send({ data: category });
    },
  );

  app.delete(
    "/admin/credits/categories/:id",
    { preHandler: [requireCapability("recognition.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const category = await prisma.creditCategory.findFirst({
        where: { id, programId: request.programId },
      });
      if (!category) throw new LoyaltyError("POINT_CATEGORY_NOT_FOUND", 404);
      const usage = await prisma.customPointTransaction.count({ where: { categoryId: id } });
      if (usage > 0) {
        const deactivated = await prisma.creditCategory.update({
          where: { id },
          data: { isActive: false },
        });
        await audit(request.programId, request.actor, "CONFIG_CHANGE", "point_category", id, {
          action: "ARCHIVE",
          usage,
        });
        return reply.send({ data: { mode: "ARCHIVED", category: deactivated } });
      }
      await prisma.creditCategory.delete({ where: { id } });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "point_category", id, {
        action: "DELETE",
        usage: 0,
      });
      return reply.status(204).send();
    },
  );

  app.get(
    "/admin/credits/exchange-requests",
    { preHandler: [requireCapability("exchange.view")] },
    async (request, reply) => {
      const query = pageSchema
        .extend({ memberId: z.string().optional(), status: exchangeStatusSchema.optional() })
        .parse(request.query);
      return reply.send({
        data: await walletService.exchangeRequests(request.programId, {
          ...query,
          includeApprovalDetails: true,
        }),
      });
    },
  );

  app.post(
    "/admin/credits/exchange-requests/:id/approve",
    {
      preHandler: [requireCapability("exchange.approve")],
    },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z
        .object({ note: z.string().trim().max(1000).optional() })
        .default({})
        .parse(request.body);
      const voucher = await prisma.pointExchangeRequest.findFirst({
        where: { id, programId: request.programId },
        select: { approvalRequestId: true },
      });
      if (!voucher) throw new LoyaltyError("POINT_EXCHANGE_REQUEST_NOT_FOUND", 404);
      if (voucher.approvalRequestId) throw new LoyaltyError("POINT_EXCHANGE_APPROVAL_VIA_WORKFLOW", 409);
      const result = await walletService.updateExchangeRequest(
        request.programId,
        id,
        "APPROVED",
        request.actor,
        { note: body.note },
      );
      if (result.status === "APPROVED" || result.status === "REJECTED") {
        await notifyCreditExchangeDecision(request.programId, id, result.status);
      }
      await clearDirectExchangeNotifications(request.programId, id).catch((error: unknown) =>
        request.log.warn({ err: error, voucherId: id }, "Failed to clear direct exchange notifications"),
      );
      await audit(
        request.programId,
        request.actor,
        "CREDIT_EXCHANGE",
        "point_exchange_request",
        id,
        { status: "APPROVED", documentNumber: result.documentNumber, note: body.note },
      );
      return reply.send({ data: result });
    },
  );

  app.post(
    "/admin/credits/exchange-requests/:id/complete",
    { preHandler: [requireCapability("exchange.complete")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z
        .object({
          reference: z.string().trim().min(1).max(200),
          note: z.string().trim().max(1000).optional(),
        })
        .parse(request.body);
      const result = await walletService.updateExchangeRequest(
        request.programId,
        id,
        "COMPLETED",
        request.actor,
        { reference: body.reference, note: body.note },
      );
      await notifyCreditExchangeDecision(request.programId, id, "COMPLETED");
      await audit(
        request.programId,
        request.actor,
        "CREDIT_EXCHANGE",
        "point_exchange_request",
        id,
        {
          status: "COMPLETED",
          documentNumber: result.documentNumber,
          reference: body.reference,
          note: body.note,
        },
      );
      return reply.send({ data: result });
    },
  );

  app.post(
    "/admin/credits/exchange-requests/:id/cancel",
    { preHandler: [requireCapability("exchange.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z
        .object({
          status: z.enum(["CANCELLED", "REJECTED"]).default("CANCELLED"),
          reason: z.string().trim().min(1).max(500),
        })
        .parse(request.body);
      const result = await prisma.$transaction(async (tx) => {
        const voucher = await tx.pointExchangeRequest.findFirst({
          where: { id, programId: request.programId },
          select: { status: true, approvalRequestId: true },
        });
        if (!voucher) throw new LoyaltyError("POINT_EXCHANGE_REQUEST_NOT_FOUND", 404);
        if (voucher.approvalRequestId && voucher.status === "PENDING") {
          if (body.status === "REJECTED") throw new LoyaltyError("POINT_EXCHANGE_REJECT_VIA_WORKFLOW", 409);
          const now = new Date();
          const changed = await tx.approvalRequest.updateMany({
            where: {
              id: voucher.approvalRequestId,
              programId: request.programId,
              actionKey: "POINT_EXCHANGE",
              subjectId: id,
              status: "PENDING",
            },
            data: {
              status: "CANCELLED",
              currentStepOrder: null,
              resolvedAt: now,
              resolvedBy: request.adminId,
              resolutionComment: body.reason,
            },
          });
          if (changed.count !== 1) throw new LoyaltyError("APPROVAL_REQUEST_NOT_PENDING", 409);
          await tx.approvalRequestStep.updateMany({
            where: { approvalRequestId: voucher.approvalRequestId, status: { in: ["PENDING", "WAITING"] } },
            data: { status: "SKIPPED", completedAt: now },
          });
          await tx.adminNotification.updateMany({
            where: {
              programId: request.programId,
              triggerEvent: "admin.approval.pending",
              actionUrl: `/approvals?request=${encodeURIComponent(voucher.approvalRequestId)}`,
              readAt: null,
            },
            data: { readAt: now },
          });
        }
        return walletService.updateExchangeRequestWithTransaction(
          tx,
          request.programId,
          id,
          body.status,
          request.actor,
          { reason: body.reason },
        );
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (result.status === "REJECTED" || result.status === "CANCELLED") {
        await notifyCreditExchangeDecision(request.programId, id, result.status);
      }
      await clearDirectExchangeNotifications(request.programId, id).catch((error: unknown) =>
        request.log.warn({ err: error, voucherId: id }, "Failed to clear direct exchange notifications"),
      );
      await audit(
        request.programId,
        request.actor,
        "CREDIT_EXCHANGE",
        "point_exchange_request",
        id,
        {
          status: body.status,
          documentNumber: result.documentNumber,
          reason: body.reason,
        },
      );
      return reply.send({ data: result });
    },
  );

  app.post(
    "/admin/credits/exchange-rates",
    { preHandler: [requireCapability("exchange.manage")] },
    async (request, reply) => {
      const body = z
        .object({
          pointTypeId: z.string().min(1),
          valueMinorPerPoint: z.number().int().positive(),
          currency: z.string().length(3),
          payoutMechanism: z.string().trim().min(1).max(120),
          payoutType: z.enum(["CASH", "NON_CASH"]),
          minPoints: z.number().int().positive().default(1),
          maxPoints: z.number().int().positive().optional(),
          periodLimitPoints: z.number().int().positive().optional(),
          periodDays: z.number().int().positive().max(3660).default(30),
          expiresAt: z.string().datetime().nullish(),
        })
        .refine(
          (value) => value.maxPoints == null || value.maxPoints >= value.minPoints,
          "Maximum must be greater than or equal to minimum",
        )
        .refine(
          (value) => value.expiresAt == null || new Date(value.expiresAt).getTime() > Date.now(),
          "Expiry must be in the future",
        )
        .parse(request.body);
      const result = await walletService.createExchangeRate(
        request.programId,
        { pointTypeId: body.pointTypeId },
        { ...body, expiresAt: body.expiresAt ? new Date(body.expiresAt) : null },
      );
      await audit(
        request.programId,
        request.actor,
        "CONFIG_CHANGE",
        "point_exchange_rate",
        result.id,
        body,
      );
      return reply.status(201).send({ data: result });
    },
  );

  app.get(
    "/admin/credits/exchange-rates",
    { preHandler: [requireCapability("exchange.view")] },
    async (request, reply) => {
      const rates = await walletService.exchangeRates(request.programId, false);
      const creators = await createdByForEntities(
        request.programId,
        "point_exchange_rate",
        rates.map((rate) => rate.id),
      );
      return reply.send({
        data: rates.map((rate) => ({ ...rate, createdBy: creators.get(rate.id) ?? null })),
      });
    },
  );

  app.get(
    "/admin/credits/bank/cycles",
    { preHandler: [requireCapability("bank.view")] },
    async (request, reply) => {
      const query = z.object({ pointTypeId: z.string().optional() }).parse(request.query);
      const cycles = await prisma.pointBankCycle.findMany({
        where: {
          programId: request.programId,
          ...(query.pointTypeId ? { pointTypeId: query.pointTypeId } : {}),
        },
        include: {
          pointType: { select: { id: true, code: true, name: true, unitLabel: true } },
          _count: { select: { transactions: true } },
        },
        orderBy: { startsAt: "desc" },
        take: 100,
      });
      const [creators, allocationTotals] = await Promise.all([
        createdByForEntities(request.programId, "point_bank_cycle", cycles.map((cycle) => cycle.id)),
        cycles.length === 0
          ? []
          : prisma.pointBankTransaction.groupBy({
              by: ["cycleId"],
              where: {
                programId: request.programId,
                cycleId: { in: cycles.map((cycle) => cycle.id) },
                AND: [
                  {
                    OR: [
                      { amount: { lt: 0 }, type: { not: "CYCLE_CLEAR" } },
                      { type: { in: [...BANK_CYCLE_RETURN_TYPES] }, amount: { gt: 0 } },
                    ],
                  },
                  {
                    OR: cycles.map((cycle) => ({
                      cycleId: cycle.id,
                      createdAt: {
                        gte: cycle.createdAt,
                        lte: cycle.clearedAt ?? new Date(),
                      },
                    })),
                  },
                ],
              },
              _sum: { amount: true },
            }),
      ]);
      const allocationsByCycle = new Map<string, number>();
      for (const allocation of allocationTotals) {
        if (allocation.cycleId) {
          allocationsByCycle.set(
            allocation.cycleId,
            netBankCycleAllocated(allocation._sum.amount, 0),
          );
        }
      }
      const actors = await resolveBankCycleActors(
        request.programId,
        cycles.flatMap((cycle) => cycle.clearedBy ? [cycle.clearedBy] : []),
      );
      return reply.send({
        data: cycles.map((cycle) => ({
          ...cycle,
          allocated: allocationsByCycle.get(cycle.id) ?? cycle.allocated,
          transactionsCount: cycle._count.transactions,
          createdBy: creators.get(cycle.id) ?? null,
          closedBy: cycle.clearedBy ? actors.get(cycle.clearedBy) ?? null : null,
        })),
      });
    },
  );

  app.get(
    "/admin/credits/bank/cycles/:id",
    { preHandler: [requireCapability("bank.view")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const query = pageSchema.parse(request.query);
      const cycle = await prisma.pointBankCycle.findFirst({
        where: { id, programId: request.programId },
        include: { pointType: { select: { id: true, code: true, name: true, unitLabel: true } } },
      });
      if (!cycle) throw new LoyaltyError("POINT_BANK_CYCLE_NOT_FOUND", 404);
      const transactionCutoff = cycle.clearedAt ?? new Date();
      const transactionStart = cycle.createdAt;
      const legacyTransactionStart = cycle.startsAt > cycle.createdAt ? cycle.startsAt : cycle.createdAt;
      const transactionWhere: Prisma.PointBankTransactionWhereInput = {
        programId: request.programId,
        pointTypeId: cycle.pointTypeId,
        AND: [
          {
            OR: [
              { cycleId: cycle.id, createdAt: { gte: transactionStart, lte: transactionCutoff } },
              {
                cycleId: null,
                createdAt: { gte: legacyTransactionStart, lte: transactionCutoff },
              },
            ],
          },
        ],
      };
      const [items, total, allocation, creators] = await Promise.all([
        prisma.pointBankTransaction.findMany({
          where: transactionWhere,
          include: {
            pointType: { select: { id: true, code: true, name: true, unitLabel: true } },
            cycle: { select: { id: true, startsAt: true, endsAt: true, status: true } },
          },
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.pointBankTransaction.count({ where: transactionWhere }),
        prisma.pointBankTransaction.aggregate({
          where: {
            programId: request.programId,
            pointTypeId: cycle.pointTypeId,
            ...bankCycleAllocationWhere(cycle.id, transactionStart, transactionCutoff),
          },
          _sum: { amount: true },
        }),
        createdByForEntities(request.programId, "point_bank_cycle", [cycle.id]),
      ]);
      const actorIds = [
        ...(cycle.clearedBy ? [cycle.clearedBy] : []),
        ...items.map((transaction) => transaction.actorId),
      ];
      const actors = await resolveBankCycleActors(request.programId, actorIds);
      return reply.send({
        data: {
          ...cycle,
          allocated: netBankCycleAllocated(allocation._sum.amount, cycle.allocated),
          createdBy: creators.get(cycle.id) ?? null,
          closedBy: cycle.clearedBy ? actors.get(cycle.clearedBy) ?? null : null,
          transactions: {
            items: items.map((transaction) => ({
              ...transaction,
              actor: actors.get(transaction.actorId) ?? null,
            })),
            total,
            page: query.page,
            pageSize: query.pageSize,
            totalPages: Math.ceil(total / query.pageSize),
          },
        },
      });
    },
  );

  app.post(
    "/admin/credits/bank/cycles/open",
    { preHandler: [requireCapability("bank.manage")] },
    async (request, reply) => {
      const body = z
        .object({
          pointTypeId: z.string().min(1),
          startsAt: z.string().datetime().optional(),
          endsAt: z.string().datetime().optional(),
          note: z.string().trim().max(500).optional(),
          clearBankOnClose: z.boolean().default(false),
        })
        .parse(request.body);
      const pointType = await prisma.pointTypeDefinition.findFirst({
        where: {
          id: body.pointTypeId,
          programId: request.programId,
          bankEnabled: true,
          archivedAt: null,
        },
      });
      if (!pointType) throw new LoyaltyError("POINT_TYPE_NOT_FOUND", 404);
      const startsAt = body.startsAt ? new Date(body.startsAt) : new Date();
      const endsAt = body.endsAt
        ? new Date(body.endsAt)
        : new Date(startsAt.getTime() + pointType.allowanceCycleDays * 86_400_000);
      if (endsAt <= startsAt || endsAt <= new Date()) throw new LoyaltyError("POINT_BANK_CYCLE_DATES_INVALID", 400);
      const cycle = await prisma.$transaction(async (tx) => {
        const bank = await tx.pointBank.upsert({
          where: { programId_pointTypeId: { programId: request.programId, pointTypeId: pointType.id } },
          create: { programId: request.programId, pointTypeId: pointType.id, balance: 0 },
          update: {},
        });
        // Serialize cycle creation with both another open request and wallet
        // debits, which acquire this same bank row before updating allocations.
        await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "PointBank" WHERE "id" = ${bank.id} FOR UPDATE`;
        await closeExpiredBankCycle(tx, request.programId, pointType.id);
        const refreshedBank = await tx.pointBank.findUniqueOrThrow({ where: { id: bank.id } });
        const current = await tx.pointBankCycle.findFirst({
          where: { programId: request.programId, pointTypeId: pointType.id, status: "OPEN" },
          select: { id: true },
        });
        if (current) throw new LoyaltyError("POINT_BANK_CYCLE_ALREADY_OPEN", 409);
        const created = await tx.pointBankCycle.create({
          data: {
            programId: request.programId,
            pointTypeId: pointType.id,
            startsAt,
            endsAt,
            opening: refreshedBank.balance,
            clearBankOnClose: body.clearBankOnClose,
            note: body.note,
          },
        });
        await audit(
          request.programId,
          request.actor,
          "CONFIG_CHANGE",
          "point_bank_cycle",
          created.id,
          {
            created: true,
            pointTypeId: created.pointTypeId,
            startsAt: created.startsAt,
            endsAt: created.endsAt,
            opening: created.opening,
            clearBankOnClose: created.clearBankOnClose,
          },
          body.note,
          tx,
        );
        return created;
      });
      return reply.status(201).send({ data: cycle });
    },
  );

  app.patch(
    "/admin/credits/bank/cycles/:id",
    { preHandler: [requireCapability("bank.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z.object({ startsAt: z.string().datetime().optional(), endsAt: z.string().datetime().optional(), clearBankOnClose: z.boolean().optional() })
        .refine((value) => value.startsAt !== undefined || value.endsAt !== undefined || value.clearBankOnClose !== undefined).parse(request.body);
      const snapshot = await prisma.pointBankCycle.findFirst({ where: { id, programId: request.programId } });
      if (!snapshot) throw new LoyaltyError("POINT_BANK_CYCLE_NOT_FOUND", 404);
      const updated = await prisma.$transaction(async (tx) => {
        const bank = await tx.pointBank.findUnique({ where: { programId_pointTypeId: { programId: request.programId, pointTypeId: snapshot.pointTypeId } }, select: { id: true } });
        if (!bank) throw new LoyaltyError("POINT_BANK_NOT_FOUND", 404);
        await tx.$queryRaw`SELECT "id" FROM "PointBank" WHERE "id" = ${bank.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "PointBankCycle" WHERE "id" = ${id} AND "programId" = ${request.programId} FOR UPDATE`;
        const cycle = await tx.pointBankCycle.findFirst({ where: { id, programId: request.programId } });
        if (!cycle) throw new LoyaltyError("POINT_BANK_CYCLE_NOT_FOUND", 404);
        if (cycle.status !== "OPEN" || (cycle.clearBankOnClose && cycle.endsAt <= new Date())) throw new LoyaltyError("POINT_BANK_CYCLE_NOT_OPEN", 409);
        const now = new Date();
        const startsAt = body.startsAt ? new Date(body.startsAt) : cycle.startsAt;
        const endsAt = body.endsAt ? new Date(body.endsAt) : cycle.endsAt;
        if ((body.startsAt && startsAt.getTime() !== cycle.startsAt.getTime() && startsAt <= now) ||
            (body.endsAt && endsAt.getTime() !== cycle.endsAt.getTime() && endsAt <= now) || endsAt <= startsAt)
          throw new LoyaltyError("POINT_BANK_CYCLE_DATES_INVALID", 400);
        if (body.clearBankOnClose === true && endsAt <= now) throw new LoyaltyError("POINT_BANK_CYCLE_CLEAR_END_IN_PAST", 400);
        const result = await tx.pointBankCycle.update({ where: { id }, data: { startsAt, endsAt, ...(body.clearBankOnClose !== undefined ? { clearBankOnClose: body.clearBankOnClose } : {}) } });
        await audit(request.programId, request.actor, "CONFIG_CHANGE", "point_bank_cycle", id,
          { previousStartsAt: cycle.startsAt, previousEndsAt: cycle.endsAt, previousClearBankOnClose: cycle.clearBankOnClose, startsAt, endsAt, clearBankOnClose: result.clearBankOnClose }, undefined, tx);
        return result;
      });
      return reply.send({ data: updated });
    },
  );

  app.post(
    "/admin/credits/bank/cycles/:id/clear",
    { preHandler: [requireCapability("bank.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z.object({ reason: z.string().trim().min(1).max(500) }).parse(request.body);
      const cycleSnapshot = await prisma.pointBankCycle.findFirst({
        where: { id, programId: request.programId },
      });
      if (!cycleSnapshot) throw new LoyaltyError("POINT_BANK_CYCLE_NOT_FOUND", 404);
      // Lock the bank before the cycle to serialize closing with funding and allocations.
      const result = await prisma.$transaction(async (tx) => {
        const bank = await tx.pointBank.findUnique({
          where: { programId_pointTypeId: { programId: request.programId, pointTypeId: cycleSnapshot.pointTypeId } },
          select: { id: true },
        });
        if (!bank) throw new LoyaltyError("POINT_BANK_NOT_FOUND", 404);
        await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "PointBank" WHERE "id" = ${bank.id} FOR UPDATE`;
        await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "PointBankCycle" WHERE "id" = ${id} AND "programId" = ${request.programId} FOR UPDATE`;
        const cycle = await tx.pointBankCycle.findFirst({ where: { id, programId: request.programId } });
        if (!cycle) throw new LoyaltyError("POINT_BANK_CYCLE_NOT_FOUND", 404);
        if (cycle.status !== "OPEN") throw new LoyaltyError("POINT_BANK_CYCLE_NOT_OPEN", 409);
        const [currentBank, allocations] = await Promise.all([
          tx.pointBank.findUniqueOrThrow({ where: { id: bank.id } }),
          tx.pointBankTransaction.aggregate({
            where: bankCycleAllocationWhere(
              cycle.id,
              cycle.createdAt,
            ),
            _sum: { amount: true },
          }),
        ]);
        const clearedPoints = cycle.clearBankOnClose ? await clearCycleBank(tx, { id: bank.id, balance: currentBank.balance }, cycle, request.actor.id, body.reason) : 0;
        const updated = await tx.pointBankCycle.update({
          where: { id },
          data: {
            status: "CLEARED",
            allocated: netBankCycleAllocated(allocations._sum.amount, 0),
            closing: cycle.clearBankOnClose ? 0 : currentBank.balance,
            clearedAt: new Date(),
            clearedBy: request.actor.id,
            clearReason: body.reason,
          },
        });
        await audit(
          request.programId,
          request.actor,
          "CREDIT_BANK",
          "point_bank_cycle",
          id,
          {
            status: "CLEARED",
            clearedPoints,
            pointTypeId: updated.pointTypeId,
            startsAt: updated.startsAt,
            endsAt: updated.endsAt,
            opening: updated.opening,
            allocated: updated.allocated,
            closing: updated.closing,
            clearedAt: updated.clearedAt,
            clearedBy: updated.clearedBy,
          },
          body.reason,
          tx,
        );
        return updated;
      });
      return reply.send({ data: result });
    },
  );

  app.get(
    "/admin/credits/audit",
    { preHandler: [requireCapability("audit.view")] },
    async (request, reply) => {
      const query = pageSchema
        .extend({
          action: z.string().optional(),
          actorId: z.string().optional(),
          entityType: z.string().optional(),
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
          format: z.enum(["json", "csv"]).default("json"),
        })
        .parse(request.query);
      const where: Prisma.AuditLogWhereInput = {
        programId: request.programId,
        ...(query.action ? { action: query.action as never } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...((query.from ?? query.to)
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.auditLog.count({ where }),
      ]);
      if (query.format === "csv") {
        const columns = [
          "id",
          "actorType",
          "actorId",
          "action",
          "entityType",
          "entityId",
          "reason",
          "amount",
          "pointTypeId",
          "memberId",
          "beforeBalance",
          "afterBalance",
          "diff",
          "createdAt",
        ];
        const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
        const rows = items.map((item) => {
          const diff =
            item.diff && typeof item.diff === "object" && !Array.isArray(item.diff)
              ? (item.diff as Record<string, unknown>)
              : {};
          return [
            item.id,
            item.actorType,
            item.actorId,
            item.action,
            item.entityType,
            item.entityId,
            item.reason,
            diff.amount,
            diff.pointTypeId,
            diff.memberId,
            diff.beforeBalance,
            diff.afterBalance,
            JSON.stringify(diff),
            item.createdAt.toISOString(),
          ]
            .map(escape)
            .join(",");
        });
        return reply
          .header("Content-Type", "text/csv; charset=utf-8")
          .header("Content-Disposition", 'attachment; filename="point-audit.csv"')
          .send([columns.join(","), ...rows].join("\n") + "\n");
      }
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

  done();
}
