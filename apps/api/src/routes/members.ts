import { BadgesService, TiersService } from "@loyaltyos/badges";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { createdByForEntities } from "../lib/created-by.js";
import { LoyaltyError } from "../lib/errors.js";
import {
  hashMemberPassword,
  memberCredentialSummary,
  validateMemberUsername,
} from "../lib/member-auth.js";
import {
  isMicrosoftTenantId,
  MICROSOFT_PROVIDER,
  normalizeMicrosoftTenantId,
} from "../lib/microsoft-auth.js";
import { notificationsService } from "../lib/notifications-setup.js";
import { issueOnboardingForMember } from "../lib/occasion-issuance.js";
import { assertCapability, requireCapability } from "../lib/permissions.js";
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
  username: z.string().trim().min(3).max(120).optional(),
  password: z.string().min(10).max(1024).optional(),
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
      if (body.password && !body.username) {
        throw new LoyaltyError("USERNAME_REQUIRED_FOR_PASSWORD", 400);
      }
      if (body.username ?? body.password)
        await assertCapability(request, "member.credentials.manage");
      const normalizedUsername = body.username ? validateMemberUsername(body.username) : null;
      const passwordHash = body.password ? await hashMemberPassword(body.password) : null;
      const member = await prisma.$transaction(async (tx) => {
        const created = await tx.member.create({
          data: {
            externalId: body.externalId,
            email: body.email,
            phone: body.phone,
            firstName: body.firstName,
            lastName: body.lastName,
            department: body.department,
            photoUrl: body.photoUrl,
            metadata: body.metadata as Prisma.InputJsonValue,
            tags: body.tags,
            programId: request.programId,
          },
        });
        if (normalizedUsername) {
          await tx.memberCredential.create({
            data: {
              programId: request.programId,
              memberId: created.id,
              username: body.username?.trim() ?? normalizedUsername,
              usernameNormalized: normalizedUsername,
              passwordHash,
              passwordChangedAt: passwordHash ? new Date() : null,
            },
          });
        }
        return created;
      });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "member", member.id, {
        created: true,
        email: member.email,
      });
      if (normalizedUsername) {
        await audit(
          request.programId,
          request.actor,
          "CONFIG_CHANGE",
          "member_credentials",
          member.id,
          {
            username: normalizedUsername,
            passwordSet: Boolean(passwordHash),
          },
        );
      }
      void issueOnboardingForMember(request.programId, member.id).catch((error: unknown) => {
        request.log.error({ err: error, memberId: member.id }, "Failed to issue onboarding campaigns");
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
          { id: { contains: query.search } },
          { email: { contains: query.search, mode: "insensitive" } },
          { firstName: { contains: query.search, mode: "insensitive" } },
          { lastName: { contains: query.search, mode: "insensitive" } },
          { externalId: { contains: query.search, mode: "insensitive" } },
        ];
      }

      const [members, total] = await Promise.all([
        prisma.member.findMany({
          where,
          include: {
            credential: { select: { username: true, passwordHash: true, passwordChangedAt: true } },
          },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.member.count({ where }),
      ]);
      const creators = await createdByForEntities(
        request.programId,
        "member",
        members.map((member) => member.id),
      );
      const items = await Promise.all(
        members.map(async (member) => {
          const { credential, ...safeMember } = member;
          return {
            ...safeMember,
            createdBy: creators.get(member.id) ?? null,
            ...memberCredentialSummary(credential),
            pointWallets: await walletService.memberWallets(member.id, request.programId, true),
          };
        }),
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
        include: {
          credential: { select: { username: true, passwordHash: true, passwordChangedAt: true } },
        },
      });
      if (!member) {
        return reply
          .status(404)
          .send({ error: { code: "NOT_FOUND", message: "Member not found" } });
      }
      return reply.send({
        data: {
          ...(() => {
            const { credential, ...safeMember } = member;
            return { ...safeMember, ...memberCredentialSummary(credential) };
          })(),
          pointWallets: await walletService.memberWallets(member.id, request.programId, true),
        },
      });
    },
  );

  const patchMemberSchema = z.object({
    locale: z.enum(["vi-VN", "en-US"]).nullable().optional(),
    email: z.string().email().nullable().optional(),
    externalId: z.string().trim().max(255).nullable().optional(),
    phone: z.string().trim().max(80).nullable().optional(),
    firstName: z.string().trim().max(120).nullable().optional(),
    lastName: z.string().trim().max(120).nullable().optional(),
    department: z.string().trim().max(120).nullable().optional(),
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
      if (body.email !== undefined) data.email = body.email;
      if (body.externalId !== undefined) data.externalId = body.externalId;
      if (body.phone !== undefined) data.phone = body.phone;
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

  const credentialsSchema = z.object({
    username: z.string().trim().min(3).max(120).optional(),
    password: z.string().min(10).max(1024).optional(),
  });

  app.put(
    "/admin/members/:id/credentials",
    { preHandler: [requireCapability("member.credentials.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = credentialsSchema.parse(request.body);
      const member = await prisma.member.findFirst({
        where: { id, programId: request.programId },
        select: { id: true },
      });
      if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
      const current = await prisma.memberCredential.findUnique({ where: { memberId: id } });
      if (!current && !body.username) throw new LoyaltyError("USERNAME_REQUIRED", 400);
      if (!current && !body.password) throw new LoyaltyError("PASSWORD_REQUIRED", 400);
      const username = body.username ?? current?.username;
      if (!username) throw new LoyaltyError("USERNAME_REQUIRED", 400);
      const normalizedUsername = validateMemberUsername(username);
      const passwordHash = body.password ? await hashMemberPassword(body.password) : undefined;
      const credential = await prisma.$transaction(async (tx) => {
        const updated = await tx.memberCredential.upsert({
          where: { memberId: id },
          create: {
            programId: request.programId,
            memberId: id,
            username: username.trim(),
            usernameNormalized: normalizedUsername,
            passwordHash: passwordHash ?? null,
            passwordChangedAt: passwordHash ? new Date() : null,
          },
          update: {
            username: username.trim(),
            usernameNormalized: normalizedUsername,
            ...(passwordHash ? { passwordHash, passwordChangedAt: new Date() } : {}),
          },
        });
        if (passwordHash) await tx.session.deleteMany({ where: { userId: id } });
        return updated;
      });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "member_credentials", id, {
        username: credential.username,
        passwordReset: Boolean(passwordHash),
      });
      return reply.send({ data: memberCredentialSummary(credential) });
    },
  );

  app.delete(
    "/admin/members/:id/credentials",
    { preHandler: [requireCapability("member.credentials.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const deleted = await prisma.$transaction(async (tx) => {
        const removed = await tx.memberCredential.deleteMany({
          where: { memberId: id, programId: request.programId },
        });
        if (removed.count > 0) await tx.session.deleteMany({ where: { userId: id } });
        return removed;
      });
      if (deleted.count === 0) throw new LoyaltyError("CREDENTIALS_NOT_CONFIGURED", 404);
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "member_credentials", id, {
        credentialsRemoved: true,
      });
      return reply.status(204).send();
    },
  );

  const identitySchema = z.object({
    providerSubject: z.string().trim().min(1).max(300),
    tenantId: z.string().trim().min(1).max(120),
    email: z.string().email().optional(),
    displayName: z.string().trim().max(200).optional(),
  });

  app.get(
    "/admin/members/:id/microsoft-identities",
    { preHandler: [requireCapability("member.credentials.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const identities = await prisma.memberExternalIdentity.findMany({
        where: { memberId: id, programId: request.programId },
        select: {
          id: true,
          provider: true,
          providerSubject: true,
          tenantId: true,
          email: true,
          displayName: true,
          createdAt: true,
        },
      });
      return reply.send({ data: identities });
    },
  );

  app.post(
    "/admin/members/:id/microsoft-identities",
    { preHandler: [requireCapability("member.credentials.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = identitySchema.parse(request.body);
      if (!isMicrosoftTenantId(body.tenantId))
        throw new LoyaltyError("MICROSOFT_TENANT_ID_INVALID", 400);
      const tenantId = normalizeMicrosoftTenantId(body.tenantId);
      const member = await prisma.member.findFirst({
        where: { id, programId: request.programId },
        select: { id: true, email: true },
      });
      if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
      if (body.email && member.email?.toLowerCase() !== body.email.toLowerCase()) {
        throw new LoyaltyError("IDENTITY_EMAIL_MISMATCH", 409);
      }
      const existing = await prisma.memberExternalIdentity.findFirst({
        where: {
          programId: request.programId,
          provider: MICROSOFT_PROVIDER,
          tenantId,
          providerSubject: body.providerSubject,
        },
      });
      if (existing && existing.memberId !== id)
        throw new LoyaltyError("IDENTITY_ALREADY_LINKED", 409);
      const memberTenantIdentity = await prisma.memberExternalIdentity.findFirst({
        where: {
          programId: request.programId,
          memberId: id,
          provider: MICROSOFT_PROVIDER,
          tenantId,
        },
      });
      if (memberTenantIdentity && memberTenantIdentity.providerSubject !== body.providerSubject) {
        throw new LoyaltyError("MEMBER_MICROSOFT_IDENTITY_EXISTS", 409);
      }
      const identity = existing
        ? await prisma.memberExternalIdentity.update({
            where: { id: existing.id },
            data: {
              email: body.email?.toLowerCase() ?? member.email,
              displayName: body.displayName,
            },
          })
        : await prisma.memberExternalIdentity.create({
            data: {
              programId: request.programId,
              memberId: id,
              provider: MICROSOFT_PROVIDER,
              providerSubject: body.providerSubject,
              tenantId,
              email: body.email?.toLowerCase() ?? member.email,
              displayName: body.displayName,
            },
          });
      await audit(
        request.programId,
        request.actor,
        "CONFIG_CHANGE",
        "member_external_identity",
        identity.id,
        {
          provider: identity.provider,
          tenantId: identity.tenantId,
          memberId: identity.memberId,
          email: identity.email,
          linked: true,
        },
      );
      return reply.status(existing ? 200 : 201).send({
        data: {
          id: identity.id,
          provider: identity.provider,
          providerSubject: identity.providerSubject,
          tenantId: identity.tenantId,
          email: identity.email,
          displayName: identity.displayName,
          createdAt: identity.createdAt,
        },
      });
    },
  );

  app.delete(
    "/admin/members/:id/microsoft-identities/:identityId",
    { preHandler: [requireCapability("member.credentials.manage")] },
    async (request, reply) => {
      const { id, identityId } = z
        .object({ id: z.string(), identityId: z.string() })
        .parse(request.params);
      const identity = await prisma.memberExternalIdentity.findFirst({
        where: { id: identityId, memberId: id, programId: request.programId },
      });
      if (!identity) throw new LoyaltyError("IDENTITY_NOT_FOUND", 404);
      await prisma.memberExternalIdentity.delete({ where: { id: identity.id } });
      await audit(
        request.programId,
        request.actor,
        "CONFIG_CHANGE",
        "member_external_identity",
        identity.id,
        {
          provider: identity.provider,
          tenantId: identity.tenantId,
          memberId: id,
          unlinked: true,
        },
      );
      return reply.status(204).send();
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
    const [wallets, pendingClaims] = await Promise.all([
      walletService.memberWallets(memberId, request.programId),
      prisma.campaignClaim.aggregate({
        where: {
          memberId,
          status: "PENDING",
          campaign: { programId: request.programId, deletedAt: null },
        },
        _sum: { pointsAwarded: true },
      }),
    ]);
    // The program now supports multiple configurable credit wallets. The old
    // balance card used to read only the primary wallet, which made a member
    // with a non-primary balance appear to have zero points.
    const confirmed = wallets.reduce((sum, wallet) => sum + wallet.balance, 0);
    const pending = pendingClaims._sum.pointsAwarded ?? 0;
    const primary = wallets.find((wallet) => wallet.isPrimary) ?? wallets[0];
    return reply.send({
      data: {
        confirmed,
        pending,
        total: confirmed + pending,
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

  app.get("/members/me/notifications/unread-count", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const unreadCount = await notificationsService.getMemberUnreadNotificationCount(request.memberId);
    return reply.send({ data: { unreadCount } });
  });

  app.patch("/members/me/notifications/:id", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ read: z.boolean() }).parse(request.body);
    const notification = await notificationsService.setMemberNotificationRead(
      request.memberId,
      id,
      body.read,
    );
    return reply.send({ data: notification });
  });

  app.post("/members/me/notifications/read-all", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const markedRead = await notificationsService.markMemberNotificationsRead(request.memberId);
    return reply.send({ data: { markedRead } });
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
