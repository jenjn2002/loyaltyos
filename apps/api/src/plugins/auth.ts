import type { AuditActorType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

import { prisma } from "../db.js";
import type { AuditActor } from "../lib/audit.js";
import { adminLucia } from "../lib/auth/admin-lucia.js";
import { lucia } from "../lib/auth/lucia.js";
import { assertCapability, capabilityForAdminRequest } from "../lib/permissions.js";

declare module "fastify" {
  interface FastifyRequest {
    programId: string;
    apiKeyScope: string;
    memberId: string | null;
    adminId: string | null;
    actor: AuditActor;
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
async function authPluginImpl(app: FastifyInstance): Promise<void> {
  app.decorateRequest("programId", "");
  app.decorateRequest("apiKeyScope", "");
  app.decorateRequest("memberId", null);
  app.decorateRequest("adminId", null);
  app.decorateRequest("actor", { type: "SYSTEM" as AuditActorType, id: "anonymous" });

  app.addHook("preHandler", async (request) => {
    // Replace shared default actor with a fresh per-request instance
    request.actor = { type: "SYSTEM" as AuditActorType, id: "anonymous" };

    // Skip auth for public routes (magic link, admin login, etc.)
    if (
      request.url.startsWith("/api/v1/auth/") ||
      request.url.startsWith("/api/v1/admin/login") ||
      request.url.startsWith("/api/v1/admin/logout") ||
      request.url.startsWith("/healthz") ||
      request.url.startsWith("/readyz")
    ) {
      return;
    }

    // 1. An explicit member bearer token takes precedence over cookies. The
    // admin and customer apps can run on different ports of the same host,
    // which means the browser sends both cookies to both apps. Checking the
    // admin cookie first would incorrectly turn a customer request into an
    // admin request and leave request.memberId empty.
    const authorization = request.headers.authorization;
    if (authorization?.startsWith("Bearer ")) {
      const sessionId = authorization.slice("Bearer ".length).trim();
      if (sessionId) {
        const { user } = await lucia.validateSession(sessionId);
        if (user) {
          if (user.status !== "ACTIVE") {
            throw Object.assign(new Error("Member account is inactive"), { statusCode: 403 });
          }
          request.memberId = user.id;
          request.programId = user.programId;
          request.apiKeyScope = "MEMBER";
          request.actor = { type: "MEMBER", id: user.id };
          return;
        }
      }
    }

    // 2. Try admin session (cookie)
    const cookieHeader = request.headers.cookie;
    if (cookieHeader) {
      const adminSessionId = adminLucia.readSessionCookie(cookieHeader);
      if (adminSessionId) {
        const { user: adminUser } = await adminLucia.validateSession(adminSessionId);
        if (adminUser) {
          request.adminId = adminUser.id;
          request.programId = adminUser.programId;
          request.apiKeyScope = "SERVER";
          request.actor = { type: "ADMIN_USER", id: adminUser.id };
          return;
        }
      }
    }

    // 3. Try member session cookie
    if (cookieHeader) {
      const sessionId = lucia.readSessionCookie(cookieHeader);
      if (sessionId) {
        const { session: _session, user } = await lucia.validateSession(sessionId);
        if (user) {
          // Treat an omitted status as legacy ACTIVE; migrated records always
          // have an explicit status with ACTIVE as the database default.
          if (user.status !== "ACTIVE") {
            throw Object.assign(new Error("Member account is inactive"), { statusCode: 403 });
          }
          request.memberId = user.id;
          request.programId = user.programId;
          request.apiKeyScope = "MEMBER";
          request.actor = { type: "MEMBER", id: user.id };
          return;
        }
      }
    }

    // 4. Fall back to API key
    const apiKey = request.headers["x-api-key"] as string | undefined;
    const programId = request.headers["x-program-id"] as string | undefined;

    if (!apiKey) {
      throw Object.assign(new Error("Missing X-API-Key header or valid session"), {
        statusCode: 401,
      });
    }

    const key = await prisma.apiKey.findUnique({
      where: { key: apiKey },
    });

    if (!key?.isActive) {
      throw Object.assign(new Error("Invalid API key"), { statusCode: 401 });
    }

    if (key.expiresAt && key.expiresAt < new Date()) {
      throw Object.assign(new Error("API key has expired"), { statusCode: 401 });
    }

    if (programId && programId !== key.programId) {
      throw Object.assign(new Error("API key cannot access the requested program"), {
        statusCode: 403,
      });
    }

    await prisma.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });

    request.programId = key.programId;
    request.apiKeyScope = key.scope;
    request.actor = { type: "API_KEY", id: key.id };
  });

  // All protected admin routes require an admin session or a server-scoped key.
  // This guard is global so a newly added admin module cannot accidentally omit it.
  app.addHook("preHandler", async (request) => {
    if (!request.url.startsWith("/api/v1/admin/")) return;
    if (
      request.url.startsWith("/api/v1/admin/login") ||
      request.url.startsWith("/api/v1/admin/logout")
    )
      return;
    if (!request.adminId && request.apiKeyScope !== "SERVER")
      throw Object.assign(new Error("Admin access required"), { statusCode: 403 });
    const capability = capabilityForAdminRequest(request.method, request.url);
    if (capability) await assertCapability(request, capability);
  });
}

export const authPlugin = fp(authPluginImpl, { name: "auth" });
export default authPlugin;
