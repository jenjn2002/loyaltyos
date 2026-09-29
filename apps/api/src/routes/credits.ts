import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import {
  decideApprovalRequest,
  ensurePointExchangeApprovalRequest,
} from "../lib/approval-workflows.js";
import { audit } from "../lib/audit.js";
import { createdByForEntities } from "../lib/created-by.js";
import { LoyaltyError } from "../lib/errors.js";
import { notificationsService } from "../lib/notifications-setup.js";
import { assertCapability, requireCapability } from "../lib/permissions.js";
import { BANK_CYCLE_RETURN_TYPES, walletService } from "../lib/wallets.js";
import { pointExchangeApprovalHook } from "../lib/workflow-integrations.js";
import { notifyCreditExchangeDecision } from "../lib/member-notifications.js";

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
  through?: Date | null,
): Prisma.PointBankTransactionWhereInput {
  return {
    cycleId,
    ...(through ? { createdAt: { lte: through } } : {}),
    OR: [
      { amount: { lt: 0 } },
      { type: { in: [...BANK_CYCLE_RETURN_TYPES] }, amount: { gt: 0 } },
    ],
  };
}

function netBankCycleAllocated(transactionTotal: number | null, fallback: number): number {
  return transactionTotal === null ? fallback : Math.max(0, -transactionTotal);
}

const exchangeStatusSchema = z.enum(["PENDING", "APPROVED", "COMPLETED", "CANCELLED", "REJECTED"]);

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

  app.get(
    "/admin/credits/bank/transactions",
    { preHandler: [requireCapability("bank.view")] },
    async (request, reply) => {
      const query = pageSchema
        .extend({
          pointTypeId: z.string().optional(),
          type: z.string().trim().min(1).max(80).optional(),
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
        })
        .parse(request.query);
      const where: Prisma.PointBankTransactionWhereInput = {
        programId: request.programId,
        ...(query.pointTypeId ? { pointTypeId: query.pointTypeId } : {}),
        ...(query.type ? { type: query.type } : {}),
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
      const body = z.object({ pointTypeId: z.string().trim().min(1).optional() }).parse(request.body ?? {});
      const result = await walletService.expire(request.programId, request.actor, body.pointTypeId);
      await audit(
        request.programId,
        request.actor,
        "CREDIT_ADJUSTMENT",
        "point_expiration_run",
        result.runId,
        {
          operation: "RUN_EXPIRY",
          pointTypeId: body.pointTypeId ?? null,
          expiredLots: result.expired,
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
        if (result.status === "APPROVED" || result.status === "REJECTED") {
          await notifyCreditExchangeDecision(request.programId, id, result.status);
        }
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
      if (result.status === "APPROVED" || result.status === "REJECTED") {
        await notifyCreditExchangeDecision(request.programId, id, result.status);
      }
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
      if (result.status === "REJECTED") {
        await notifyCreditExchangeDecision(request.programId, id, result.status);
      }
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
                      { amount: { lt: 0 } },
                      { type: { in: [...BANK_CYCLE_RETURN_TYPES] }, amount: { gt: 0 } },
                    ],
                  },
                  {
                    OR: cycles.map((cycle) => ({
                      cycleId: cycle.id,
                      ...(cycle.clearedAt ? { createdAt: { lte: cycle.clearedAt } } : {}),
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
      const transactionCutoff = cycle.clearedAt ?? cycle.endsAt;
      const transactionWhere: Prisma.PointBankTransactionWhereInput = {
        programId: request.programId,
        pointTypeId: cycle.pointTypeId,
        AND: [
          {
            OR: [
              { cycleId: cycle.id, createdAt: { lte: transactionCutoff } },
              {
                cycleId: null,
                createdAt: { gte: cycle.startsAt, lte: transactionCutoff },
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
            ...bankCycleAllocationWhere(cycle.id, cycle.clearedAt),
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
      const cycle = await prisma.$transaction(async (tx) => {
        const bank = await tx.pointBank.upsert({
          where: { programId_pointTypeId: { programId: request.programId, pointTypeId: pointType.id } },
          create: { programId: request.programId, pointTypeId: pointType.id, balance: 0 },
          update: {},
        });
        // Serialize cycle creation with both another open request and wallet
        // debits, which acquire this same bank row before updating allocations.
        await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "PointBank" WHERE "id" = ${bank.id} FOR UPDATE`;
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
            opening: bank.balance,
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
          },
          body.note,
          tx,
        );
        return created;
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
      const cycleSnapshot = await prisma.pointBankCycle.findFirst({
        where: { id, programId: request.programId },
      });
      if (!cycleSnapshot) throw new LoyaltyError("POINT_BANK_CYCLE_NOT_FOUND", 404);
      // Closing a cycle records allocation and closing balance. It never destroys
      // the unallocated bank balance. Lock ordering matches debitBank (bank,
      // then cycle) so a concurrent issuance is either fully included or waits
      // until after this cycle has been closed.
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
            where: bankCycleAllocationWhere(cycle.id),
            _sum: { amount: true },
          }),
        ]);
        const updated = await tx.pointBankCycle.update({
          where: { id },
          data: {
            status: "CLEARED",
            allocated: netBankCycleAllocated(allocations._sum.amount, 0),
            closing: currentBank.balance,
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
