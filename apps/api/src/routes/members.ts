import { BadgesService, TiersService } from "@loyaltyos/badges";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { LoyaltyError } from "../lib/errors.js";
import { notificationsService } from "../lib/notifications-setup.js";
import { requireCapability } from "../lib/permissions.js";
import { walletService } from "../lib/wallets.js";

const badges = new BadgesService(prisma);
const tiers = new TiersService(prisma);

const createMemberSchema = z.object({
  externalId: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  department: z.string().max(120).optional(),
  photoUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
});

const adjustSchema = z.object({
  pointTypeId: z.string().min(1),
  amount: z.number().int(),
  reason: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
});

function requireSelfOrAdmin(
  request: { memberId: string | null; adminId: string | null; apiKeyScope: string },
  memberId: string,
): void {
  if (request.memberId !== memberId && request.adminId == null && request.apiKeyScope !== "SERVER")
    throw new LoyaltyError("FORBIDDEN", 403);
}

export function membersRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.post(
    "/members",
    { preHandler: [requireCapability("member.manage")] },
    async (request, reply) => {
      const body = createMemberSchema.parse(request.body);
      const member = await prisma.member.create({
        data: {
          ...body,
          metadata: body.metadata as Prisma.InputJsonValue,
          programId: request.programId,
        },
      });
      return reply.status(201).send({ data: member });
    },
  );

  app.get(
    "/members",
    { preHandler: [requireCapability("member.view")] },
    async (request, reply) => {
      const query = z
        .object({
          page: z.coerce.number().int().min(1).optional().default(1),
          pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
          search: z.string().optional(),
          department: z.string().optional(),
          status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
        })
        .parse(request.query);

      const where: Prisma.MemberWhereInput = {
        programId: request.programId,
        ...(query.status ? { status: query.status } : { deletedAt: null, status: "ACTIVE" }),
        ...(query.department
          ? { department: { contains: query.department, mode: "insensitive" } }
          : {}),
      };

      if (query.search) {
        where.OR = [
          { email: { contains: query.search, mode: "insensitive" } },
          { firstName: { contains: query.search, mode: "insensitive" } },
          { lastName: { contains: query.search, mode: "insensitive" } },
          { externalId: { contains: query.search, mode: "insensitive" } },
        ];
      }

      const [members, total] = await Promise.all([
        prisma.member.findMany({
          where,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.member.count({ where }),
      ]);
      const items = await Promise.all(
        members.map(async (member) => ({
          ...member,
          pointWallets: await walletService.memberWallets(member.id, request.programId, true),
        })),
      );

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

  app.get("/members/me", async (request, reply) => {
    const memberId = request.memberId;
    if (!memberId) {
      return reply.status(401).send({
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      });
    }

    const member = await prisma.member.findFirst({
      where: { id: memberId, programId: request.programId, deletedAt: null },
    });
    if (!member) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Member not found" } });
    }
    return reply.send({ data: member });
  });

  const patchMeSchema = z.object({
    locale: z.string().trim().min(2).max(35).optional(),
    firstName: z.string().max(120).optional(),
    lastName: z.string().max(120).optional(),
    department: z.string().max(120).optional(),
    photoUrl: z.string().url().nullable().optional(),
  });

  /** PATCH /members/me — update authenticated member's locale */
  app.patch(
    "/members/me",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const memberId = request.memberId;
      if (!memberId) {
        throw new LoyaltyError("UNAUTHORIZED", 401);
      }

      const body = patchMeSchema.parse(request.body);

      const member = await prisma.member.findUnique({
        where: { id: memberId },
        include: { program: { select: { supportedLocales: true } } },
      });
      if (!member) {
        throw new LoyaltyError("NOT_FOUND", 404);
      }

      const programLocales = member.program.supportedLocales;
      if (body.locale && !programLocales.includes(body.locale)) {
        throw new LoyaltyError("INVALID_INPUT", 400);
      }

      const updated = await prisma.member.update({
        where: { id: memberId },
        data: body,
      });

      return reply.send({ data: updated });
    },
  );

  app.get("/members/directory", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const query = z
      .object({
        search: z.string().trim().max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    const where: Prisma.MemberWhereInput = {
      programId: request.programId,
      id: { not: request.memberId },
      status: "ACTIVE",
      deletedAt: null,
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: "insensitive" } },
              { lastName: { contains: query.search, mode: "insensitive" } },
              { email: { contains: query.search, mode: "insensitive" } },
              { department: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.member.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          department: true,
          photoUrl: true,
        },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.member.count({ where }),
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

  app.get(
    "/members/:id",
    { preHandler: [requireCapability("member.view")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);

      const member = await prisma.member.findFirst({
        where: { id, programId: request.programId },
      });
      if (!member) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Member not found" } });
      }
      return reply.send({
        data: {
          ...member,
          pointWallets: await walletService.memberWallets(member.id, request.programId, true),
        },
      });
    },
  );

  const patchMemberSchema = z.object({
    locale: z.enum(["es-MX", "en-US"]).nullable().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    department: z.string().max(120).optional(),
    photoUrl: z.string().url().nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
    tags: z.array(z.string()).optional(),
  });

  /** PATCH /members/:id — update member fields including locale override */
  app.patch(
    "/members/:id",
    { preHandler: [requireCapability("member.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = patchMemberSchema.parse(request.body);

      const data: Record<string, unknown> = {};
      if (body.locale !== undefined) data.locale = body.locale;
      if (body.firstName !== undefined) data.firstName = body.firstName;
      if (body.lastName !== undefined) data.lastName = body.lastName;
      if (body.department !== undefined) data.department = body.department;
      if (body.photoUrl !== undefined) data.photoUrl = body.photoUrl;
      if (body.tags !== undefined) data.tags = body.tags;
      if (body.metadata !== undefined) data.metadata = body.metadata;

      const existing = await prisma.member.findFirst({
        where: { id, programId: request.programId },
        select: { id: true },
      });
      if (!existing) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
      const member = await prisma.member.update({
        where: { id: existing.id },
        data: data as Prisma.MemberUpdateInput,
      });
      return reply.send({ data: member });
    },
  );

  // GET /members/me/balance — authenticated member balance
  app.get("/members/me/balance", async (request, reply) => {
    const memberId = request.memberId;
    if (!memberId) {
      return reply
        .status(401)
        .send({ error: { code: "UNAUTHORIZED", message: "Authentication required" } });
    }
    const wallets = await walletService.memberWallets(memberId, request.programId);
    const primary = wallets.find((wallet) => wallet.isPrimary) ?? wallets[0];
    return reply.send({
      data: {
        confirmed: primary?.balance ?? 0,
        pending: 0,
        total: primary?.balance ?? 0,
        pointTypeId: primary?.pointTypeId ?? null,
        wallets,
      },
    });
  });

  // GET /members/me/transactions — authenticated member transaction history
  app.get("/members/me/transactions", async (request, reply) => {
    const memberId = request.memberId;
    if (!memberId) {
      return reply
        .status(401)
        .send({ error: { code: "UNAUTHORIZED", message: "Authentication required" } });
    }
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
        type: z.string().optional(),
      })
      .parse(request.query);

    const result = await walletService.history(request.programId, {
      memberId,
      action: query.type,
      page: query.page,
      pageSize: query.pageSize,
    });
    return reply.send({ data: result });
  });

  // GET /members/me/badges — authenticated member badges
  app.get("/members/me/badges", async (request, reply) => {
    const memberId = request.memberId;
    if (!memberId) {
      return reply
        .status(401)
        .send({ error: { code: "UNAUTHORIZED", message: "Authentication required" } });
    }
    const result = await badges.getMemberBadges(memberId);
    return reply.send({ data: result });
  });

  // GET /members/me/tier — authenticated member tier progress
  app.get("/members/me/tier", async (request, reply) => {
    const memberId = request.memberId;
    if (!memberId) {
      return reply
        .status(401)
        .send({ error: { code: "UNAUTHORIZED", message: "Authentication required" } });
    }
    const result = await tiers.getMemberTier(memberId, request.programId);
    return reply.send({ data: result });
  });

  app.get(
    "/members/:id/balance",
    { preHandler: [requireCapability("wallet.view")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);

      return reply.send({
        data: await walletService.memberWallets(id, request.programId, true),
      });
    },
  );

  app.get(
    "/members/:id/transactions",
    { preHandler: [requireCapability("wallet.view")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const query = z
        .object({
          page: z.coerce.number().int().min(1).optional().default(1),
          pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
        })
        .parse(request.query);

      const result = await walletService.history(request.programId, {
        memberId: id,
        page: query.page,
        pageSize: query.pageSize,
      });
      return reply.send({ data: result });
    },
  );

  app.post(
    "/members/:id/adjust",
    {
      preHandler: [requireCapability("wallet.adjust")],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = adjustSchema.parse(request.body);
      const idempotencyKey = request.headers["idempotency-key"] as string;
      if (!idempotencyKey) {
        return reply.status(400).send({
          error: { code: "MISSING_HEADER", message: "Idempotency-Key header is required" },
        });
      }

      const result = await walletService.adjust(
        request.programId,
        id,
        { pointTypeId: body.pointTypeId },
        body.amount,
        body.reason,
        request.actor,
        idempotencyKey,
        body.expiresAt ? new Date(body.expiresAt) : undefined,
      );
      return reply.status(201).send({ data: result });
    },
  );

  // GET /members/:id/badges — Get member badges with progress
  app.get(
    "/members/:id/badges",
    { preHandler: [requireCapability("member.view")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const result = await badges.getMemberBadges(id);
      return reply.send({ data: result });
    },
  );

  // GET /members/:id/tier — Get member tier with progress to next
  app.get(
    "/members/:id/tier",
    { preHandler: [requireCapability("member.view")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const result = await tiers.getMemberTier(id, request.programId);
      return reply.send({ data: result });
    },
  );

  // ═══ Member Devices ═══

  const deviceCreateSchema = z.object({
    token: z.string().min(1),
    platform: z.enum(["IOS", "ANDROID", "WEB"]),
  });

  // POST /members/:id/devices — idempotent upsert by token
  app.post("/members/:id/devices", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    requireSelfOrAdmin(request, id);
    const body = deviceCreateSchema.parse(request.body);

    const member = await prisma.member.findFirst({
      where: { id, programId: request.programId, deletedAt: null },
      select: { id: true },
    });
    if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
    const existingDevice = await prisma.memberDevice.findUnique({
      where: { token: body.token },
      select: { memberId: true },
    });
    if (existingDevice && existingDevice.memberId !== id)
      throw new LoyaltyError("DEVICE_TOKEN_ALREADY_REGISTERED", 409);

    const device = await prisma.memberDevice.upsert({
      where: { token: body.token },
      create: {
        memberId: id,
        programId: request.programId,
        token: body.token,
        platform: body.platform,
        lastSeenAt: new Date(),
      },
      update: {
        lastSeenAt: new Date(),
        platform: body.platform,
      },
    });

    return reply.status(201).send({ data: device });
  });

  // DELETE /members/:id/devices/:deviceId
  app.delete("/members/:id/devices/:deviceId", async (request, reply) => {
    const { id, deviceId } = z
      .object({ id: z.string(), deviceId: z.string() })
      .parse(request.params);
    requireSelfOrAdmin(request, id);

    const device = await prisma.memberDevice.findFirst({
      where: { id: deviceId, memberId: id, programId: request.programId },
    });
    if (!device) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Device not found" } });
    }

    await prisma.memberDevice.delete({ where: { id: deviceId } });
    return reply.status(204).send();
  });

  // ═══ Notification Preferences ═══

  app.get("/members/me/notifications", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(request.query);
    const result = await notificationsService.getMemberNotifications(request.memberId, query);
    return reply.send({ data: result });
  });

  const preferenceUpdateSchema = z.object({
    channel: z.enum(["EMAIL", "SMS", "PUSH", "IN_APP"]),
    optedIn: z.boolean(),
  });

  // GET /members/:id/preferences
  app.get("/members/:id/preferences", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    requireSelfOrAdmin(request, id);
    const prefs = await notificationsService.getMemberPreferences(id, request.programId);
    return reply.send({ data: prefs });
  });

  // PATCH /members/:id/preferences
  app.patch("/members/:id/preferences", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    requireSelfOrAdmin(request, id);
    const body = preferenceUpdateSchema.parse(request.body);

    await notificationsService.upsertMemberPreference(
      id,
      request.programId,
      body.channel,
      body.optedIn,
    );

    // Return updated preferences
    const prefs = await notificationsService.getMemberPreferences(id, request.programId);
    return reply.send({ data: prefs });
  });

  done();
}
