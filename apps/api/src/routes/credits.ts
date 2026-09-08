import type { CreditTransactionType, CreditType, Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { creditService, type CreditKind } from "../lib/credits.js";
import {
  ensureCreditSettings,
  CREDIT_SETTING_DEFINITIONS,
  getCreditSettings,
  normalizeCreditSettingValues,
  requireCreditSettingPermission,
  requireSuperAdmin,
  syncExchangeRatesFromSettings,
} from "../lib/credit-settings.js";
import { LoyaltyError } from "../lib/errors.js";
import { notificationsService } from "../lib/notifications-setup.js";
import { requireAdmin } from "../plugins/require-admin.js";

const creditTypeSchema = z.enum(["P", "R"]);

const giveSchema = z.object({
  creditType: creditTypeSchema,
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
  message: z.string().trim().min(1).max(500),
  category: z.string().trim().max(80).optional(),
  categoryId: z.string().min(1).optional(),
});

const exchangeSchema = z.object({
  creditType: creditTypeSchema,
  amount: z.number().int().positive(),
  payoutType: z.enum(["CASH", "NON_CASH"]),
});

function idempotencyKey(request: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 8) {
    throw new LoyaltyError("MISSING_IDEMPOTENCY_KEY", 400);
  }
  return value;
}

async function settingsResponse(
  programId: string,
  settings: Awaited<ReturnType<typeof getCreditSettings>>,
  adminId: string | null,
  apiKeyScope: string,
) {
  const currentAdmin = adminId
    ? await prisma.adminUser.findUnique({ where: { id: adminId }, select: { role: true } })
    : null;
  const currentAdminRole = apiKeyScope === "SERVER" ? "SERVER" : (currentAdmin?.role ?? null);
  const visibleKeys: string[] = [];
  for (const definition of settings.definitions) {
    try {
      await requireCreditSettingPermission(programId, adminId, apiKeyScope, definition.key, "VIEW");
      visibleKeys.push(definition.key);
    } catch {
      // A setting can be intentionally hidden from a role.
    }
  }
  const values = Object.fromEntries(
    Object.entries(settings.values).filter(([key]) => visibleKeys.includes(key)),
  );
  return {
    values,
    definitions: settings.definitions.filter((definition) => visibleKeys.includes(definition.key)),
    permissions:
      currentAdminRole === "SUPER_ADMIN" || currentAdminRole === "SERVER"
        ? settings.permissions
        : settings.permissions.filter((permission) => permission.role === currentAdminRole),
    currentAdminRole,
  };
}

export function creditsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get("/admin/credits/settings", { preHandler: [requireAdmin] }, async (request, reply) => {
    const settings = await ensureCreditSettings(request.programId);
    return reply.send({
      data: await settingsResponse(
        request.programId,
        settings,
        request.adminId,
        request.apiKeyScope,
      ),
    });
  });

  app.patch("/admin/credits/settings", { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = z.object({ values: z.record(z.string(), z.unknown()) }).parse(request.body);
    const values = normalizeCreditSettingValues(body.values);
    const current = await ensureCreditSettings(request.programId);
    for (const key of Object.keys(values)) {
      await requireCreditSettingPermission(
        request.programId,
        request.adminId,
        request.apiKeyScope,
        key,
        "EDIT",
      );
    }
    await prisma.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(values)) {
        await tx.creditSetting.upsert({
          where: { programId_key: { programId: request.programId, key } },
          create: {
            programId: request.programId,
            key,
            value: value as never,
            updatedById: request.adminId,
          },
          update: { value: value as never, updatedById: request.adminId },
        });
      }
      if (values.reconciliation_cycle_days != null) {
        await tx.program.update({
          where: { id: request.programId },
          data: { creditBankCycleDays: Number(values.reconciliation_cycle_days) },
        });
      }
    });
    const mergedValues = { ...current.values, ...values };
    const rateSettingKeys = new Set([
      "p_credit_value_minor",
      "r_credit_value_minor",
      "payout_currency",
      "p_exchange_min_credits",
      "p_exchange_max_credits",
      "r_exchange_min_credits",
      "r_exchange_max_credits",
      "payout_mechanism",
      "payout_enabled",
    ]);
    if (Object.keys(values).some((key) => rateSettingKeys.has(key))) {
      await syncExchangeRatesFromSettings(request.programId, mergedValues);
    }
    await audit(
      request.programId,
      request.actor,
      "CONFIG_CHANGE",
      "credit_governance_settings",
      request.programId,
      { values },
    );
    const settings = await getCreditSettings(request.programId);
    return reply.send({
      data: await settingsResponse(
        request.programId,
        settings,
        request.adminId,
        request.apiKeyScope,
      ),
    });
  });

  app.patch(
    "/admin/credits/settings/permissions",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      await requireSuperAdmin(request.programId, request.adminId, request.apiKeyScope);
      const body = z
        .object({
          role: z.enum(["SUPER_ADMIN", "OPERATOR", "ANALYST"]),
          permissions: z
            .array(z.object({ key: z.string(), canView: z.boolean(), canEdit: z.boolean() }))
            .min(1),
        })
        .parse(request.body);
      const knownKeys = new Set(CREDIT_SETTING_DEFINITIONS.map((definition) => definition.key));
      for (const permission of body.permissions) {
        if (!knownKeys.has(permission.key as (typeof CREDIT_SETTING_DEFINITIONS)[number]["key"])) {
          throw new LoyaltyError("CREDIT_SETTING_UNKNOWN", 400, { key: permission.key });
        }
        if (permission.canEdit && !permission.canView) {
          throw new LoyaltyError("CREDIT_PERMISSION_EDIT_REQUIRES_VIEW", 400, {
            key: permission.key,
          });
        }
      }
      await prisma.$transaction(async (tx) => {
        for (const permission of body.permissions) {
          await tx.creditSettingPermission.upsert({
            where: {
              programId_settingKey_role: {
                programId: request.programId,
                settingKey: permission.key,
                role: body.role,
              },
            },
            create: {
              programId: request.programId,
              settingKey: permission.key,
              role: body.role,
              canView: permission.canView,
              canEdit: permission.canEdit,
              updatedById: request.adminId,
            },
            update: {
              canView: permission.canView,
              canEdit: permission.canEdit,
              updatedById: request.adminId,
            },
          });
        }
      });
      await audit(
        request.programId,
        request.actor,
        "CONFIG_CHANGE",
        "credit_setting_permissions",
        request.programId,
        body,
      );
      const settings = await getCreditSettings(request.programId);
      return reply.send({
        data: await settingsResponse(
          request.programId,
          settings,
          request.adminId,
          request.apiKeyScope,
        ),
      });
    },
  );

  app.get("/admin/credits/config", { preHandler: [requireAdmin] }, async (request, reply) => {
    const config = await prisma.program.findUnique({
      where: { id: request.programId },
      select: {
        id: true,
        creditGivingLimit: true,
        creditGivingPeriodDays: true,
        creditGivingPairLimit: true,
        creditBankCycleDays: true,
        creditExpiryWarningDays: true,
      },
    });
    if (!config) throw new LoyaltyError("NOT_FOUND", 404);
    return reply.send({ data: config });
  });

  app.patch("/admin/credits/config", { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = z
      .object({
        creditGivingLimit: z.number().int().nonnegative().nullable().optional(),
        creditGivingPeriodDays: z.number().int().positive().optional(),
        creditGivingPairLimit: z.number().int().nonnegative().nullable().optional(),
        creditBankCycleDays: z.number().int().positive().optional(),
        creditExpiryWarningDays: z.array(z.number().int().positive()).max(5).optional(),
      })
      .parse(request.body);
    const config = await prisma.program.update({
      where: { id: request.programId },
      data: body,
      select: {
        id: true,
        creditGivingLimit: true,
        creditGivingPeriodDays: true,
        creditGivingPairLimit: true,
        creditBankCycleDays: true,
        creditExpiryWarningDays: true,
      },
    });
    await audit(
      request.programId,
      request.actor,
      "CONFIG_CHANGE",
      "program_credit_config",
      request.programId,
      body,
    );
    return reply.send({ data: config });
  });

  app.get("/members/me/credits", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const balances = await creditService.balances(request.memberId, request.programId);
    return reply.send({ data: balances });
  });

  app.get("/members/me/credits/transactions", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50),
        creditType: creditTypeSchema.optional(),
      })
      .parse(request.query);
    const history = await creditService.history(request.memberId, request.programId, query);
    return reply.send({ data: history });
  });

  app.get("/members/me/recognition-feed", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(20),
        kind: z.enum(["all", "received", "given"]).default("all"),
        creditType: creditTypeSchema.optional(),
        categoryId: z.string().optional(),
      })
      .parse(request.query);
    const where: Prisma.CreditTransactionWhereInput = {
      programId: request.programId,
      type:
        query.kind === "received"
          ? ("GIVE_IN" as CreditTransactionType)
          : query.kind === "given"
            ? ("GIVE_OUT" as CreditTransactionType)
            : { in: ["GIVE_IN", "GIVE_OUT"] as CreditTransactionType[] },
      ...(query.creditType ? { creditType: query.creditType as CreditType } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.creditTransaction.findMany({
        where,
        include: {
          member: { select: { id: true, firstName: true, lastName: true, email: true } },
          counterparty: { select: { id: true, firstName: true, lastName: true, email: true } },
          categoryRef: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.creditTransaction.count({ where }),
    ]);
    return reply.send({
      data: {
        items: items.map((item) => ({
          ...item,
          category: item.categoryRef?.name ?? item.category,
        })),
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
    const rates = await creditService.rates(request.programId);
    return reply.send({ data: rates });
  });

  app.post(
    "/credits/give",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
      const body = giveSchema.parse(request.body);
      const result = await creditService.give(request.memberId, request.programId, {
        ...body,
        creditType: body.creditType as CreditKind,
        idempotencyKey: idempotencyKey(request),
      });
      const transactions = await prisma.creditTransaction.findMany({
        where: { id: { in: result.transactionIds }, programId: request.programId },
        select: {
          id: true,
          memberId: true,
          creditType: true,
          amount: true,
          balanceAfter: true,
          sourceCreditType: true,
          receivedCreditType: true,
        },
      });
      await audit(
        request.programId,
        request.actor,
        "CREDIT_GIVE",
        "credit_transaction",
        result.transactionIds[0] ?? null,
        {
          creditType: body.creditType,
          recipientCount: body.recipients.length,
          transactionIds: result.transactionIds,
          transactions,
        },
        body.message,
      );
      const recipientMembers = await prisma.member.findMany({
        where: {
          id: { in: body.recipients.map((recipient) => recipient.memberId) },
          programId: request.programId,
        },
        select: { id: true, email: true, phone: true, firstName: true, lastName: true },
      });
      for (const recipient of body.recipients) {
        const member = recipientMembers.find((candidate) => candidate.id === recipient.memberId);
        void notificationsService.sendTrigger(
          request.programId,
          "credit.received",
          recipient.memberId,
          {
            creditType: body.creditType,
            amount: recipient.amount,
            message: recipient.message ?? body.message,
            category: body.category,
            member,
            _locale: "es-MX",
          },
        );
      }
      return reply.status(201).send({ data: result });
    },
  );

  app.post(
    "/credits/exchange",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
      const body = exchangeSchema.parse(request.body);
      const result = await creditService.exchange(request.memberId, request.programId, {
        ...body,
        creditType: body.creditType as CreditKind,
        idempotencyKey: idempotencyKey(request),
      });
      const transaction = result.transactionId
        ? await prisma.creditTransaction.findUnique({
            where: { id: result.transactionId },
            select: { amount: true, balanceAfter: true, creditType: true },
          })
        : null;
      await audit(
        request.programId,
        request.actor,
        "CREDIT_EXCHANGE",
        "credit_exchange_request",
        result.requestId,
        {
          creditType: body.creditType,
          amount: body.amount,
          payoutType: body.payoutType,
          valueMinorUnits: result.valueMinorUnits,
          rateVersion: result.rateVersion,
          beforeBalance: transaction
            ? transaction.balanceAfter + Math.abs(transaction.amount)
            : null,
          afterBalance: transaction?.balanceAfter ?? null,
        },
      );
      const member = await prisma.member.findFirst({
        where: { id: request.memberId, programId: request.programId },
        select: { id: true, email: true, phone: true, firstName: true, lastName: true },
      });
      void notificationsService.sendTrigger(
        request.programId,
        "credit.exchange",
        request.memberId,
        { member, amount: body.amount, status: result.status, _locale: "es-MX" },
      );
      return reply.status(201).send({ data: result });
    },
  );

  app.get("/admin/credits/bank", { preHandler: [requireAdmin] }, async (request, reply) => {
    return reply.send({ data: await creditService.bank(request.programId) });
  });

  app.post("/admin/credits/bank/issue", { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = z
      .object({
        creditType: creditTypeSchema,
        amount: z.number().int().positive(),
        reason: z.string().trim().min(1),
      })
      .parse(request.body);
    const result = await creditService.issueToBank(request.programId, request.adminId ?? "system", {
      ...body,
      creditType: body.creditType as CreditKind,
      idempotencyKey: idempotencyKey(request),
    });
    await audit(
      request.programId,
      request.actor,
      "CREDIT_BANK",
      "credit_bank_transaction",
      result.id,
      {
        creditType: body.creditType,
        amount: body.amount,
        reason: body.reason,
        balanceAfter: result.balanceAfter,
      },
      body.reason,
    );
    return reply.status(201).send({ data: result });
  });

  app.post("/admin/credits/adjust", { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = z
      .object({
        memberId: z.string().min(1),
        creditType: creditTypeSchema,
        amount: z
          .number()
          .int()
          .refine((value) => value !== 0),
        reason: z.string().trim().min(1),
        expiresAt: z.coerce.date().optional(),
        categoryId: z.string().min(1).optional(),
      })
      .parse(request.body);
    const result = await creditService.adminAdjust(request.programId, request.adminId ?? "system", {
      ...body,
      creditType: body.creditType as CreditKind,
      idempotencyKey: idempotencyKey(request),
      expiresAt: body.expiresAt,
    });
    await audit(
      request.programId,
      request.actor,
      "CREDIT_ADJUSTMENT",
      "credit_wallet",
      body.memberId,
      {
        creditType: body.creditType,
        amount: body.amount,
        reason: body.reason,
        transactionId: result.id,
        beforeBalance: (result as { balanceBefore?: number }).balanceBefore,
        afterBalance: result.balanceAfter,
      },
      body.reason,
    );
    return reply.status(201).send({ data: result });
  });

  app.get("/admin/credits/transactions", { preHandler: [requireAdmin] }, async (request, reply) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50),
        memberId: z.string().optional(),
        creditType: creditTypeSchema.optional(),
        type: z
          .enum([
            "GRANT",
            "GIVE_OUT",
            "GIVE_IN",
            "REDEEM",
            "EXCHANGE",
            "ADJUSTMENT",
            "EXPIRATION",
            "REVERSAL",
            "CLEARANCE",
          ])
          .optional(),
        categoryId: z.string().optional(),
        dateFrom: z.coerce.date().optional(),
        dateTo: z.coerce.date().optional(),
        minAmount: z.coerce.number().int().optional(),
        maxAmount: z.coerce.number().int().optional(),
      })
      .parse(request.query);
    const where: Prisma.CreditTransactionWhereInput = {
      programId: request.programId,
      ...(query.memberId ? { memberId: query.memberId } : {}),
      ...(query.creditType ? { creditType: query.creditType as CreditType } : {}),
      ...(query.type ? { type: query.type as CreditTransactionType } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lte: query.dateTo } : {}),
            },
          }
        : {}),
      ...(query.minAmount != null || query.maxAmount != null
        ? {
            amount: {
              ...(query.minAmount != null ? { gte: query.minAmount } : {}),
              ...(query.maxAmount != null ? { lte: query.maxAmount } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.creditTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          member: {
            select: { id: true, email: true, firstName: true, lastName: true, department: true },
          },
          counterparty: {
            select: { id: true, email: true, firstName: true, lastName: true, department: true },
          },
          categoryRef: { select: { name: true } },
        },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.creditTransaction.count({ where }),
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

  app.post("/admin/credits/expire", { preHandler: [requireAdmin] }, async (request, reply) => {
    const expired = await creditService.expire(request.programId);
    return reply.send({ data: { expired } });
  });

  app.get("/admin/credits/categories", { preHandler: [requireAdmin] }, async (request, reply) => {
    const categories = await prisma.creditCategory.findMany({
      where: { programId: request.programId },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });
    return reply.send({ data: categories });
  });

  app.post("/admin/credits/categories", { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().max(500).optional(),
      })
      .parse(request.body);
    const category = await prisma.creditCategory.create({
      data: { ...body, programId: request.programId },
    });
    await audit(
      request.programId,
      request.actor,
      "CONFIG_CHANGE",
      "credit_category",
      category.id,
      body,
    );
    return reply.status(201).send({ data: category });
  });

  app.patch(
    "/admin/credits/categories/:id",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z
        .object({
          name: z.string().trim().min(1).max(80).optional(),
          description: z.string().trim().max(500).nullable().optional(),
          isActive: z.boolean().optional(),
        })
        .parse(request.body);
      const category = await prisma.creditCategory.updateMany({
        where: { id, programId: request.programId },
        data: body,
      });
      if (category.count !== 1) throw new LoyaltyError("NOT_FOUND", 404);
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "credit_category", id, body);
      return reply.send({ data: await prisma.creditCategory.findUnique({ where: { id } }) });
    },
  );

  app.delete(
    "/admin/credits/categories/:id",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const used = await prisma.creditTransaction.count({
        where: { categoryId: id, programId: request.programId },
      });
      if (used > 0) {
        await prisma.creditCategory.updateMany({
          where: { id, programId: request.programId },
          data: { isActive: false },
        });
        await audit(request.programId, request.actor, "CONFIG_CHANGE", "credit_category", id, {
          isActive: false,
          reason: "CATEGORY_IN_USE",
        });
        return reply.send({ data: { deactivated: true, reason: "CATEGORY_IN_USE" } });
      }
      await prisma.creditCategory.deleteMany({ where: { id, programId: request.programId } });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "credit_category", id, {
        deleted: true,
      });
      return reply.status(204).send();
    },
  );

  app.get(
    "/admin/credits/exchange-requests",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const query = z
        .object({
          memberId: z.string().optional(),
          status: z.string().optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(50),
        })
        .parse(request.query);
      return reply.send({ data: await creditService.exchangeRequests(request.programId, query) });
    },
  );

  app.post(
    "/admin/credits/exchange-requests/:id/approve",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const result = await creditService.approveExchange(
        request.programId,
        id,
        request.adminId ?? "system",
      );
      await audit(
        request.programId,
        request.actor,
        "CREDIT_EXCHANGE",
        "credit_exchange_request",
        id,
        { status: result.status },
      );
      return reply.send({ data: result });
    },
  );

  app.post(
    "/admin/credits/exchange-requests/:id/fulfill",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const result = await creditService.fulfillExchange(
        request.programId,
        id,
        request.adminId ?? "system",
      );
      await audit(
        request.programId,
        request.actor,
        "CREDIT_EXCHANGE",
        "credit_exchange_request",
        id,
        { status: result.status },
      );
      return reply.send({ data: result });
    },
  );

  app.post(
    "/admin/credits/exchange-requests/:id/cancel",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z.object({ reason: z.string().trim().min(1) }).parse(request.body);
      const result = await creditService.cancelExchange(
        request.programId,
        id,
        request.adminId ?? "system",
        body.reason,
      );
      await audit(
        request.programId,
        request.actor,
        "CREDIT_EXCHANGE",
        "credit_exchange_request",
        id,
        { status: "CANCELLED" },
        body.reason,
      );
      return reply.send({ data: result });
    },
  );

  app.get("/admin/credits/bank/cycles", { preHandler: [requireAdmin] }, async (request, reply) => {
    const cycles = await prisma.creditBankCycle.findMany({
      where: { programId: request.programId },
      orderBy: { startsAt: "desc" },
      take: 50,
    });
    return reply.send({ data: cycles });
  });

  app.post(
    "/admin/credits/bank/cycles/open",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const result = await creditService.openBankCycle(
        request.programId,
        request.adminId ?? "system",
      );
      await audit(request.programId, request.actor, "CREDIT_BANK", "credit_bank_cycle", result.id, {
        status: result.status,
      });
      return reply.status(201).send({ data: result });
    },
  );

  app.post(
    "/admin/credits/bank/cycles/:id/clear",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z.object({ reason: z.string().trim().min(1) }).parse(request.body);
      const result = await creditService.clearBankCycle(
        request.programId,
        id,
        request.adminId ?? "system",
        body.reason,
      );
      await audit(
        request.programId,
        request.actor,
        "CREDIT_BANK",
        "credit_bank_cycle",
        id,
        { status: result.status },
        body.reason,
      );
      return reply.send({ data: result });
    },
  );

  app.get("/admin/credits/audit", { preHandler: [requireAdmin] }, async (request, reply) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50),
        action: z.string().optional(),
        format: z.enum(["json", "csv"]).default("json"),
      })
      .parse(request.query);
    const where = {
      programId: request.programId,
      ...(query.action ? { action: query.action as never } : {}),
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
      const header = "id,actorId,action,entityType,entityId,reason,createdAt\n";
      const rows = items
        .map((item) =>
          [
            item.id,
            item.actorId,
            item.action,
            item.entityType,
            item.entityId ?? "",
            item.reason ?? "",
            item.createdAt.toISOString(),
          ]
            .map((value) => `"${String(value).replaceAll('"', '""')}"`)
            .join(","),
        )
        .join("\n");
      return reply.header("Content-Type", "text/csv").send(header + rows + (rows ? "\n" : ""));
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
  });

  app.post(
    "/admin/credits/exchange-rates",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const body = z
        .object({
          creditType: creditTypeSchema,
          valueMinorPerCredit: z.number().int().positive(),
          currency: z
            .string()
            .length(3)
            .transform((value) => value.toUpperCase()),
          payoutMechanism: z.string().trim().min(1),
          cashEligible: z.boolean().default(false),
          minCredits: z.number().int().positive().default(1),
          maxCredits: z.number().int().positive().optional(),
        })
        .parse(request.body);
      if (body.creditType === "R" && body.cashEligible) {
        throw new LoyaltyError("R_CREDIT_CASH_EXCHANGE_NOT_ALLOWED", 400);
      }
      const result = await prisma.$transaction(async (tx) => {
        const latest = await tx.creditExchangeRate.findFirst({
          where: { programId: request.programId, creditType: body.creditType as CreditType },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        await tx.creditExchangeRate.updateMany({
          where: {
            programId: request.programId,
            creditType: body.creditType as CreditType,
            isActive: true,
          },
          data: { isActive: false },
        });
        return tx.creditExchangeRate.create({
          data: {
            ...body,
            programId: request.programId,
            creditType: body.creditType as CreditType,
            version: (latest?.version ?? 0) + 1,
          },
        });
      });
      const rateSettings =
        result.creditType === "P"
          ? {
              p_credit_value_minor: result.valueMinorPerCredit,
              payout_currency: result.currency,
              payout_mechanism: result.payoutMechanism,
              payout_enabled: result.cashEligible,
              p_exchange_min_credits: result.minCredits,
              p_exchange_max_credits: result.maxCredits ?? 0,
            }
          : {
              r_credit_value_minor: result.valueMinorPerCredit,
              r_exchange_min_credits: result.minCredits,
              r_exchange_max_credits: result.maxCredits ?? 0,
            };
      await Promise.all(
        Object.entries(rateSettings).map(([key, value]) =>
          prisma.creditSetting.upsert({
            where: { programId_key: { programId: request.programId, key } },
            create: {
              programId: request.programId,
              key,
              value: value as never,
              updatedById: request.adminId,
            },
            update: { value: value as never, updatedById: request.adminId },
          }),
        ),
      );
      await audit(
        request.programId,
        request.actor,
        "CONFIG_CHANGE",
        "credit_exchange_rate",
        result.id,
        { version: result.version, creditType: result.creditType },
      );
      return reply.status(201).send({ data: result });
    },
  );

  done();
}
