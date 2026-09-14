import { hashPassword, verifyPassword } from "@loyaltyos/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { adminLucia } from "../../lib/auth/admin-lucia.js";
import { LoyaltyError } from "../../lib/errors.js";
import {
  ADMIN_CAPABILITIES,
  ADMIN_ROLE_LABELS,
  capabilitiesFor,
  requireCapability,
} from "../../lib/permissions.js";

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

const configurableAdminRoleSchema = z.enum(["OPERATOR", "ANALYST"]);
const adminPasswordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(200)
  .refine((value) => [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/].filter((pattern) => pattern.test(value)).length >= 3, {
    message: "Password must use at least 3 of lowercase, uppercase, number and symbol",
  });
const createAdminUserSchema = z.object({
  email: z.string().email().toLowerCase(),
  name: z.string().trim().min(1).max(160),
  password: adminPasswordSchema,
  role: configurableAdminRoleSchema,
});
const updateAdminUserSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    role: configurableAdminRoleSchema.optional(),
    isActive: z.boolean().optional(),
    password: adminPasswordSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "At least one change is required");

export function adminAuthRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  /** POST /admin/login — authenticate an admin user */
  app.post(
    "/admin/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);

      const admin = await prisma.adminUser.findFirst({
        where: { email: body.email, isActive: true },
      });

      // Always run argon2 to equalize timing (prevents email enumeration)
      const dummyHash =
        "$argon2id$v=19$m=19456,t=2,p=1$xxxxxxxxxxxxxxxxxxxxxx$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
      const valid = await verifyPassword(admin?.passwordHash ?? dummyHash, body.password);

      if (!admin || !valid) {
        throw new LoyaltyError("INVALID_CREDENTIALS", 401);
      }

      await prisma.adminUser.update({
        where: { id: admin.id },
        data: { lastLoginAt: new Date() },
      });

      const session = await adminLucia.createSession(admin.id, {});
      const cookie = adminLucia.createSessionCookie(session.id);
      void reply.header("Set-Cookie", cookie.serialize());

      return reply.send({
        data: {
          admin: {
            id: admin.id,
            email: admin.email,
            name: admin.name,
            role: admin.role,
            roleLabel: ADMIN_ROLE_LABELS[admin.role],
            locale: admin.locale,
          },
        },
      });
    },
  );

  /** POST /admin/logout — invalidate admin session */
  app.post("/admin/logout", async (request, reply) => {
    const cookieHeader = request.headers.cookie;
    if (cookieHeader) {
      const sessionId = adminLucia.readSessionCookie(cookieHeader);
      if (sessionId) {
        await adminLucia.invalidateSession(sessionId);
      }
    }

    const blankCookie = adminLucia.createBlankSessionCookie();
    void reply.header("Set-Cookie", blankCookie.serialize());
    return reply.send({ ok: true });
  });

  /** GET /admin/me — current admin user info */
  app.get("/admin/me", async (request, reply) => {
    const adminId = request.adminId;
    if (!adminId) {
      throw new LoyaltyError("UNAUTHORIZED", 401);
    }

    const admin = await prisma.adminUser.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        locale: true,
        programId: true,
      },
    });

    if (!admin) {
      throw new LoyaltyError("NOT_FOUND", 404);
    }

    return reply.send({
      data: {
        ...admin,
        roleLabel: ADMIN_ROLE_LABELS[admin.role],
        capabilities: await capabilitiesFor(admin.programId, admin.role),
      },
    });
  });

  const updateAdminMeSchema = z.object({
    locale: z.enum(["es-MX", "en-US"]).optional(),
    name: z.string().min(1).optional(),
  });

  /** PATCH /admin/me — update current admin user */
  app.patch("/admin/me", async (request, reply) => {
    const adminId = request.adminId;
    if (!adminId) {
      throw new LoyaltyError("UNAUTHORIZED", 401);
    }

    const body = updateAdminMeSchema.parse(request.body);

    const admin = await prisma.adminUser.update({
      where: { id: adminId },
      data: body,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        locale: true,
        programId: true,
      },
    });

    return reply.send({ data: admin });
  });

  app.get(
    "/admin/permissions",
    { preHandler: [requireCapability("permission.manage")] },
    async (request, reply) => {
      const roles = ["SUPER_ADMIN", "OPERATOR", "ANALYST"] as const;
      return reply.send({
        data: {
          capabilities: ADMIN_CAPABILITIES,
          roles: await Promise.all(
            roles.map(async (role) => ({
              role,
              label: ADMIN_ROLE_LABELS[role],
              permissions: await capabilitiesFor(request.programId, role),
            })),
          ),
        },
      });
    },
  );

  app.patch(
    "/admin/permissions/:role",
    { preHandler: [requireCapability("permission.manage")] },
    async (request, reply) => {
      const { role } = z.object({ role: z.enum(["OPERATOR", "ANALYST"]) }).parse(request.params);
      const body = z
        .object({
          permissions: z.record(z.enum(ADMIN_CAPABILITIES), z.boolean()),
        })
        .parse(request.body);
      await prisma.$transaction(
        Object.entries(body.permissions).map(([capability, allowed]) =>
          prisma.adminRolePermission.upsert({
            where: {
              programId_role_capability: {
                programId: request.programId,
                role,
                capability,
              },
            },
            create: {
              programId: request.programId,
              role,
              capability,
              allowed,
              updatedById: request.adminId,
            },
            update: { allowed, updatedById: request.adminId },
          }),
        ),
      );
      await audit(
        request.programId,
        request.actor,
        "CONFIG_CHANGE",
        "admin_role_permissions",
        role,
        { permissions: body.permissions },
      );
      return reply.send({
        data: {
          role,
          label: ADMIN_ROLE_LABELS[role],
          permissions: await capabilitiesFor(request.programId, role),
        },
      });
    },
  );

  app.get(
    "/admin/users",
    { preHandler: [requireCapability("permission.manage")] },
    async (request, reply) => {
      if (!request.adminId) throw new LoyaltyError("ADMIN_SESSION_REQUIRED", 403);
      const users = await prisma.adminUser.findMany({
        where: { programId: request.programId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          locale: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      });
      return reply.send({
        data: users.map((user) => ({ ...user, roleLabel: ADMIN_ROLE_LABELS[user.role] })),
      });
    },
  );

  app.post(
    "/admin/users",
    { preHandler: [requireCapability("permission.manage")] },
    async (request, reply) => {
      if (!request.adminId) throw new LoyaltyError("ADMIN_SESSION_REQUIRED", 403);
      const body = createAdminUserSchema.parse(request.body);
      const existing = await prisma.adminUser.findUnique({ where: { email: body.email } });
      if (existing) throw new LoyaltyError("ADMIN_EMAIL_ALREADY_EXISTS", 409);
      const user = await prisma.adminUser.create({
        data: {
          programId: request.programId,
          email: body.email,
          name: body.name,
          role: body.role,
          passwordHash: await hashPassword(body.password),
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          locale: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "admin_user", user.id, {
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
      });
      return reply.status(201).send({ data: { ...user, roleLabel: ADMIN_ROLE_LABELS[user.role] } });
    },
  );

  app.patch(
    "/admin/users/:id",
    { preHandler: [requireCapability("permission.manage")] },
    async (request, reply) => {
      if (!request.adminId) throw new LoyaltyError("ADMIN_SESSION_REQUIRED", 403);
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = updateAdminUserSchema.parse(request.body);
      const existing = await prisma.adminUser.findFirst({
        where: { id, programId: request.programId },
      });
      if (!existing) throw new LoyaltyError("ADMIN_USER_NOT_FOUND", 404);
      if (existing.role === "SUPER_ADMIN") throw new LoyaltyError("OWNER_ROLE_IMMUTABLE", 409);
      if (id === request.adminId && body.isActive === false)
        throw new LoyaltyError("CANNOT_DEACTIVATE_CURRENT_ADMIN", 409);

      const passwordHash = body.password ? await hashPassword(body.password) : undefined;
      const user = await prisma.$transaction(async (tx) => {
        const updated = await tx.adminUser.update({
          where: { id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.role !== undefined ? { role: body.role } : {}),
            ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
            ...(passwordHash ? { passwordHash } : {}),
          },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
            locale: true,
            lastLoginAt: true,
            createdAt: true,
          },
        });
        if (body.isActive === false || passwordHash) {
          await tx.adminSession.deleteMany({ where: { userId: id } });
        }
        return updated;
      });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "admin_user", user.id, {
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        passwordReset: Boolean(passwordHash),
      });
      return reply.send({ data: { ...user, roleLabel: ADMIN_ROLE_LABELS[user.role] } });
    },
  );

  done();
}
