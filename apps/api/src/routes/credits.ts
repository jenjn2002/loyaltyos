import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import {
  decideApprovalRequest,
  ensurePointExchangeApprovalRequest,
} from "../lib/approval-workflows.js";
import { audit } from "../lib/audit.js";
import { LoyaltyError } from "../lib/errors.js";
import { notificationsService } from "../lib/notifications-setup.js";
import { assertCapability, requireCapability } from "../lib/permissions.js";
import { walletService } from "../lib/wallets.js";
import { pointExchangeApprovalHook } from "../lib/workflow-integrations.js";

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

const exchangeStatusSchema = z.enum(["PENDING", "APPROVED", "COMPLETED", "CANCELLED", "REJECTED"]);

async function memberLocale(memberId: string, programId: string): Promise<string> {
  const member = await prisma.member.findFirst({
    where: { id: memberId, programId },
    select: { locale: true, program: { select: { defaultLocale: true } } },
  });
  return member?.locale ?? member?.program.defaultLocale ?? "en-US";
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
    const selfFilter: Prisma.CustomPointTransactionWhereInput =
      query.kind === "received"
        ? { memberId: request.memberId, action: "GIVE_IN" }
        : query.kind === "given"
          ? {
              memberId: request.memberId,
              action: { in: ["GIVE_OUT", "GIVE_ALLOWANCE_OUT"] },
            }
          : { action: { in: actions } };
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

  app.post(
    "/credits/give",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
      const body = z
        .object({
          sourcePointTypeId: z.string().min(1),
          destinationPointTypeId: z.string().min(1),
          fundingSource: z.enum(["BALANCE", "ALLOWANCE"]).optional(),
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
            fundingSource: body.fundingSource,
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
        for (const recipient of body.recipients) {
          const member = recipientMembers.find((candidate) => candidate.id === recipient.memberId);
          const received = result.transactions.find(
            (transaction) =>
              transaction.action === "GIVE_IN" && transaction.memberId === recipient.memberId,
          );
          void notificationsService.sendTrigger(
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
              _locale:
                member?.locale ?? (await memberLocale(recipient.memberId, request.programId)),
            },
          );
        }
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
        void notificationsService.sendTrigger(
          request.programId,
          "credit.exchange",
          request.memberId,
          { amount: body.amount, status: result.request.status, _locale: locale },
        );
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
          expiresAt: z.string().datetime().optional(),
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
        body.expiresAt ? new Date(body.expiresAt) : undefined,
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
      return reply.status(201).send({ data: result });
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
          counterpartyMemberId: z.string().optional(),
          categoryId: z.string().optional(),
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
        })
        .parse(request.query);
      return reply.send({
        data: await walletService.history(request.programId, {
          ...query,
          from: query.from ? new Date(query.from) : undefined,
          to: query.to ? new Date(query.to) : undefined,
        }),
      });
    },
  );

  app.post(
    "/admin/credits/expire",
    { preHandler: [requireCapability("wallet.adjust")] },
    async (request, reply) => {
      const expired = await walletService.expire(request.programId);
      return reply.send({ data: { expired } });
    },
  );

  app.get(
    "/admin/credits/categories",
    { preHandler: [requireCapability("wallet.view")] },
    async (request, reply) => {
      return reply.send({
        data: await prisma.creditCategory.findMany({
          where: { programId: request.programId },
          orderBy: [{ isActive: "desc" }, { name: "asc" }],
        }),
      });
    },
  );

  app.post(
    "/admin/credits/categories",
    { preHandler: [requireCapability("point_type.manage")] },
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
    { preHandler: [requireCapability("point_type.manage")] },
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
    { preHandler: [requireCapability("point_type.manage")] },
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
        data: await walletService.exchangeRequests(request.programId, query),
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
        select: { memberId: true, approvalRequestId: true },
      });
      if (!voucher) throw new LoyaltyError("POINT_EXCHANGE_REQUEST_NOT_FOUND", 404);
      const approval = await ensurePointExchangeApprovalRequest(
        request.programId,
        id,
        voucher.memberId,
      );
      if (approval) {
        await assertCapability(request, "approval.decide");
        if (!request.adminId) throw new LoyaltyError("ADMIN_SESSION_REQUIRED", 403);
        await decideApprovalRequest(
          request.programId,
          approval.id,
          request.adminId,
          "APPROVE",
          body.note,
          pointExchangeApprovalHook,
        );
        const result = await prisma.pointExchangeRequest.findUniqueOrThrow({ where: { id } });
        await audit(
          request.programId,
          request.actor,
          "CREDIT_EXCHANGE",
          "point_exchange_request",
          id,
          { status: result.status, documentNumber: result.documentNumber, note: body.note },
        );
        return reply.send({ data: result });
      }
      const result = await walletService.updateExchangeRequest(
        request.programId,
        id,
        "APPROVED",
        request.actor,
        { note: body.note },
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
      const result = await walletService.updateExchangeRequest(
        request.programId,
        id,
        body.status,
        request.actor,
        { reason: body.reason },
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
        })
        .refine(
          (value) => value.maxPoints == null || value.maxPoints >= value.minPoints,
          "Maximum must be greater than or equal to minimum",
        )
        .parse(request.body);
      const result = await walletService.createExchangeRate(
        request.programId,
        { pointTypeId: body.pointTypeId },
        body,
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
      return reply.send({ data: await walletService.exchangeRates(request.programId, false) });
    },
  );

  app.get(
    "/admin/credits/bank/cycles",
    { preHandler: [requireCapability("bank.view")] },
    async (request, reply) => {
      const query = z.object({ pointTypeId: z.string().optional() }).parse(request.query);
      return reply.send({
        data: await prisma.pointBankCycle.findMany({
          where: {
            programId: request.programId,
            ...(query.pointTypeId ? { pointTypeId: query.pointTypeId } : {}),
          },
          include: { pointType: { select: { id: true, code: true, name: true } } },
          orderBy: { startsAt: "desc" },
          take: 100,
        }),
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
      if (endsAt <= startsAt) throw new LoyaltyError("POINT_BANK_CYCLE_DATES_INVALID", 400);
      const current = await prisma.pointBankCycle.findFirst({
        where: { programId: request.programId, pointTypeId: pointType.id, status: "OPEN" },
      });
      if (current) throw new LoyaltyError("POINT_BANK_CYCLE_ALREADY_OPEN", 409);
      const bank = await prisma.pointBank.findUnique({
        where: {
          programId_pointTypeId: {
            programId: request.programId,
            pointTypeId: pointType.id,
          },
        },
      });
      const cycle = await prisma.pointBankCycle.create({
        data: {
          programId: request.programId,
          pointTypeId: pointType.id,
          startsAt,
          endsAt,
          opening: bank?.balance ?? 0,
          note: body.note,
        },
      });
      return reply.status(201).send({ data: cycle });
    },
  );

  app.post(
    "/admin/credits/bank/cycles/:id/clear",
    { preHandler: [requireCapability("bank.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z.object({ reason: z.string().trim().min(1).max(500) }).parse(request.body);
      const cycle = await prisma.pointBankCycle.findFirst({
        where: { id, programId: request.programId },
      });
      if (!cycle) throw new LoyaltyError("POINT_BANK_CYCLE_NOT_FOUND", 404);
      if (cycle.status !== "OPEN") throw new LoyaltyError("POINT_BANK_CYCLE_NOT_OPEN", 409);
      const [bank, allocations] = await Promise.all([
        prisma.pointBank.findUnique({
          where: {
            programId_pointTypeId: {
              programId: request.programId,
              pointTypeId: cycle.pointTypeId,
            },
          },
        }),
        prisma.pointBankTransaction.aggregate({
          where: { cycleId: cycle.id, amount: { lt: 0 } },
          _sum: { amount: true },
        }),
      ]);
      // Closing a cycle records allocation and closing balance. It never destroys
      // the unallocated bank balance.
      const result = await prisma.pointBankCycle.update({
        where: { id },
        data: {
          status: "CLEARED",
          allocated: Math.abs(allocations._sum.amount ?? 0),
          closing: bank?.balance ?? 0,
          clearedAt: new Date(),
          clearedBy: request.actor.id,
          note: body.reason,
        },
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
