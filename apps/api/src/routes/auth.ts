import crypto from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { adminLucia } from "../lib/auth/admin-lucia.js";
import { lucia } from "../lib/auth/lucia.js";
import { LoyaltyError } from "../lib/errors.js";
import { authenticateMember } from "../lib/member-auth.js";
import {
  buildMicrosoftAuthorizationUrl,
  clearMicrosoftStateCookie,
  discoverMicrosoft,
  exchangeMicrosoftCode,
  isMicrosoftTenantId,
  readMicrosoftState,
  validateMicrosoftConfig,
} from "../lib/microsoft-auth.js";
import { resolveMicrosoftMember } from "../lib/microsoft-member-provisioning.js";
import { notificationsService } from "../lib/notifications-setup.js";
import { issueOnboardingForMember } from "../lib/occasion-issuance.js";
import { microsoftRedirectUri, portalHomeUrl, resolvePortalUrl } from "../lib/public-urls.js";

const TOKEN_MINUTES = 15;
const HANDOFF_LIFETIME_MS = 60_000;

type HandoffEnvironment = "production" | "sandbox";
type HandoffKind = "member" | "admin";

interface HandoffClaims {
  sub: string;
  programId: string;
  kind: HandoffKind;
  iss: HandoffEnvironment;
  aud: HandoffEnvironment;
  iat: number;
  exp: number;
  jti: string;
  returnTo: string;
}

function currentHandoffEnvironment(): HandoffEnvironment {
  const environment = process.env.LOYALTYOS_ENVIRONMENT;
  if (environment !== "production" && environment !== "sandbox") {
    throw new LoyaltyError("ENVIRONMENT_HANDOFF_UNAVAILABLE", 503);
  }
  return environment;
}

function handoffSecret(): string {
  const secret = process.env.ENV_HANDOFF_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new LoyaltyError("ENVIRONMENT_HANDOFF_UNAVAILABLE", 503);
  }
  return secret;
}

function handoffSignature(payload: string): string {
  return crypto.createHmac("sha256", handoffSecret()).update(payload).digest("base64url");
}

function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\u0000-\u001f]/.test(value)) {
    return "/";
  }
  try {
    const parsed = new URL(value, "https://loyaltyos.invalid");
    if (parsed.origin !== "https://loyaltyos.invalid") return "/";
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}

function signHandoff(claims: HandoffClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${handoffSignature(payload)}`;
}

function verifyHandoff(token: string, target: HandoffEnvironment): HandoffClaims {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new LoyaltyError("ENVIRONMENT_HANDOFF_INVALID", 401);
  const expected = Buffer.from(handoffSignature(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new LoyaltyError("ENVIRONMENT_HANDOFF_INVALID", 401);
  }
  let claims: HandoffClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as HandoffClaims;
  } catch {
    throw new LoyaltyError("ENVIRONMENT_HANDOFF_INVALID", 401);
  }
  const now = Date.now();
  if (
    claims.aud !== target ||
    claims.iss === target ||
    (claims.iss !== "production" && claims.iss !== "sandbox") ||
    (claims.kind !== "member" && claims.kind !== "admin") ||
    !claims.sub ||
    !claims.programId ||
    !claims.jti ||
    !Number.isFinite(claims.iat) ||
    !Number.isFinite(claims.exp) ||
    claims.iat > now + 5_000 ||
    claims.exp <= now ||
    claims.exp - claims.iat > HANDOFF_LIFETIME_MS ||
    typeof claims.returnTo !== "string"
  ) {
    throw new LoyaltyError("ENVIRONMENT_HANDOFF_EXPIRED_OR_INVALID", 401);
  }
  return { ...claims, returnTo: safeReturnPath(claims.returnTo) };
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function requestSessionIds(request: FastifyRequest): string[] {
  const sessionIds: string[] = [];
  const cookieHeader = request.headers.cookie;
  if (cookieHeader) {
    const cookieSessionId = lucia.readSessionCookie(cookieHeader);
    if (cookieSessionId) sessionIds.push(cookieSessionId);
  }

  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    const bearerSessionId = authorization.slice("Bearer ".length).trim();
    if (bearerSessionId && !sessionIds.includes(bearerSessionId)) {
      sessionIds.push(bearerSessionId);
    }
  }

  return sessionIds;
}

const magicLinkSchema = z.object({
  email: z.string().email().toLowerCase(),
  locale: z.string().optional(),
});

const verifySchema = z.object({
  token: z.string().min(1),
});

const passwordLoginSchema = z.object({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(1024),
});

function publicProgramId(request: {
  headers: Record<string, unknown>;
  query?: unknown;
}): string | null {
  const header = request.headers["x-program-id"];
  if (typeof header === "string" && header.trim()) return header.trim();
  if (request.query && typeof request.query === "object") {
    const queryProgramId = (request.query as { programId?: unknown }).programId;
    if (typeof queryProgramId === "string" && queryProgramId.trim()) return queryProgramId.trim();
  }
  return null;
}

async function recordAuthAudit(
  programId: string,
  entityId: string | null,
  outcome: string,
  method = "password",
): Promise<void> {
  try {
    await audit(
      programId,
      { type: "SYSTEM", id: "customer-auth" },
      "OTHER",
      "member_auth",
      entityId,
      { outcome, method },
    );
  } catch (error) {
    console.error("[Auth] Audit write failed:", error instanceof Error ? error.message : error);
  }
}

function memberSessionResponse(
  member: {
    id: string;
    email: string | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    programId: string;
    joinedAt: Date;
  },
  session: { id: string; expiresAt: Date },
) {
  return {
    sessionId: session.id,
    expiresAt: session.expiresAt,
    member: {
      id: member.id,
      email: member.email,
      phone: member.phone,
      firstName: member.firstName,
      lastName: member.lastName,
      programId: member.programId,
      joinedAt: member.joinedAt,
    },
  };
}

async function triggerMagicLinkEmail(
  memberId: string,
  programId: string,
  magicLinkUrl: string,
  locale?: string,
): Promise<void> {
  try {
    const member = await prisma.member.findFirst({
      where: { id: memberId },
      include: {
        memberTiers: { include: { tier: true } },
        program: { select: { name: true } },
      },
    });

    const currentTier = member?.memberTiers.find((mt) => !mt.downgradedAt)?.tier.name;

    await notificationsService.sendTrigger(programId, "auth.magic_link", memberId, {
      magicLinkUrl,
      _locale: locale ?? "vi-VN",
      member: {
        id: member?.id,
        email: member?.email,
        phone: member?.phone,
        firstName: member?.firstName,
        lastName: member?.lastName,
        currentTier,
      },
      program: {
        name: member?.program.name,
      },
    });
  } catch (err) {
    console.error("[Auth] Magic link notification failed:", err);
  }
}

export function authRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.post(
    "/auth/environment-handoff",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = z.object({
        kind: z.enum(["member", "admin"]),
        target: z.enum(["production", "sandbox"]),
        returnTo: z.string().optional(),
      }).parse(request.body);
      const source = currentHandoffEnvironment();
      if (body.target === source) throw new LoyaltyError("ENVIRONMENT_HANDOFF_TARGET_INVALID", 400);

      let subjectId: string | null = null;
      let programId: string | null = null;
      if (body.kind === "admin") {
        const cookieHeader = request.headers.cookie;
        const sessionId = cookieHeader ? adminLucia.readSessionCookie(cookieHeader) : null;
        if (sessionId) {
          const { user } = await adminLucia.validateSession(sessionId);
          if (user) {
            const admin = await prisma.adminUser.findFirst({
              where: { id: user.id, isActive: true },
              select: { id: true, programId: true },
            });
            if (admin) {
              subjectId = admin.id;
              programId = admin.programId;
            }
          }
        }
      } else {
        const authorization = request.headers.authorization;
        const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
        const cookieHeader = request.headers.cookie;
        const cookieSession = cookieHeader ? lucia.readSessionCookie(cookieHeader) : null;
        const sessionId = bearer || cookieSession;
        if (sessionId) {
          const { user } = await lucia.validateSession(sessionId);
          if (user?.status === "ACTIVE" && !user.deactivatedAt) {
            const member = await prisma.member.findFirst({
              where: { id: user.id, programId: user.programId, status: "ACTIVE", deletedAt: null },
              select: { id: true, programId: true },
            });
            if (member) {
              subjectId = member.id;
              programId = member.programId;
            }
          }
        }
      }
      if (!subjectId || !programId) throw new LoyaltyError("UNAUTHORIZED", 401);

      const now = Date.now();
      const claims: HandoffClaims = {
        sub: subjectId,
        programId,
        kind: body.kind,
        iss: source,
        aud: body.target,
        iat: now,
        exp: now + HANDOFF_LIFETIME_MS,
        jti: crypto.randomBytes(24).toString("base64url"),
        returnTo: safeReturnPath(body.returnTo),
      };
      return reply.send({ data: { ticket: signHandoff(claims), returnTo: claims.returnTo, expiresAt: new Date(claims.exp).toISOString() } });
    },
  );

  app.post(
    "/auth/environment-handoff/exchange",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = z.object({ ticket: z.string().min(1).max(4096) }).parse(request.body);
      const target = currentHandoffEnvironment();
      const claims = verifyHandoff(body.ticket, target);
      if (claims.programId.length > 120) throw new LoyaltyError("ENVIRONMENT_HANDOFF_INVALID", 401);

      await prisma.environmentHandoffUse.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      try {
        await prisma.environmentHandoffUse.create({
          data: { jti: claims.jti, expiresAt: new Date(claims.exp) },
        });
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
          throw new LoyaltyError("ENVIRONMENT_HANDOFF_ALREADY_USED", 409);
        }
        throw error;
      }

      if (claims.kind === "admin") {
        const admin = await prisma.adminUser.findFirst({
          where: { id: claims.sub, programId: claims.programId, isActive: true },
          select: { id: true },
        });
        if (!admin) throw new LoyaltyError("ENVIRONMENT_HANDOFF_ACCOUNT_UNAVAILABLE", 403);
        const session = await adminLucia.createSession(admin.id, {});
        void reply.header("Set-Cookie", adminLucia.createSessionCookie(session.id).serialize());
        return reply.send({ data: { kind: "admin", returnTo: claims.returnTo } });
      }

      const member = await prisma.member.findFirst({
        where: {
          id: claims.sub,
          programId: claims.programId,
          status: "ACTIVE",
          deletedAt: null,
          deactivatedAt: null,
        },
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          programId: true,
          joinedAt: true,
        },
      });
      if (!member) throw new LoyaltyError("ENVIRONMENT_HANDOFF_ACCOUNT_UNAVAILABLE", 403);
      const session = await lucia.createSession(member.id, {});
      void reply.header("Set-Cookie", lucia.createSessionCookie(session.id).serialize());
      return reply.send({
        data: {
          kind: "member",
          returnTo: claims.returnTo,
          ...memberSessionResponse(member, session),
        },
      });
    },
  );

  /** GET /auth/methods — public, program-scoped login methods. */
  app.get("/auth/methods", async (request, reply) => {
    const programId = publicProgramId({
      headers: request.headers as Record<string, unknown>,
      query: request.query,
    });
    const config = programId
      ? await prisma.microsoftAuthConfig.findUnique({ where: { programId } })
      : null;
    const microsoftConfigured = Boolean(
      config?.enabled &&
      config.tenantId &&
      isMicrosoftTenantId(config.tenantId) &&
      config.clientId &&
      config.encryptedClientSecret &&
      config.scopes.includes("openid"),
    );
    return reply.send({
      data: {
        password: true,
        microsoft: microsoftConfigured,
      },
    });
  });

  /** POST /auth/login — customer username/password login. */
  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = passwordLoginSchema.parse(request.body);
      const programId = publicProgramId({
        headers: request.headers as Record<string, unknown>,
        query: request.query,
      });
      if (!programId) throw new LoyaltyError("INVALID_CREDENTIALS", 401);

      const member = await authenticateMember(prisma, programId, body.username, body.password);
      if (!member) {
        void recordAuthAudit(programId, null, "failure");
        throw new LoyaltyError("INVALID_CREDENTIALS", 401);
      }

      const session = await lucia.createSession(member.id, {});
      const cookie = lucia.createSessionCookie(session.id);
      void reply.header("Set-Cookie", cookie.serialize());
      await prisma.member.update({ where: { id: member.id }, data: { lastActiveAt: new Date() } });
      void recordAuthAudit(programId, member.id, "success");
      return reply.send({ data: memberSessionResponse(member, session) });
    },
  );

  /** GET /auth/microsoft — begin additive Microsoft OIDC login. */
  app.get("/auth/microsoft", async (request, reply) => {
    const query = z.object({ programId: z.string().min(1).optional() }).parse(request.query);
    const programId = publicProgramId({
      headers: request.headers as Record<string, unknown>,
      query,
    });
    if (!programId) throw new LoyaltyError("MICROSOFT_SIGN_IN_UNAVAILABLE", 400);
    const config = await prisma.microsoftAuthConfig.findUnique({ where: { programId } });
    if (!config?.enabled) throw new LoyaltyError("MICROSOFT_SIGN_IN_UNAVAILABLE", 404);
    validateMicrosoftConfig(config);
    const discovery = await discoverMicrosoft(config);
    const authorization = buildMicrosoftAuthorizationUrl(config, discovery, programId);
    void reply.header("Set-Cookie", authorization.stateCookie);
    return reply.redirect(authorization.url);
  });

  /** GET /auth/microsoft/callback — validate OIDC claims and resolve the member. */
  app.get("/auth/microsoft/callback", async (request, reply) => {
    const query = z
      .object({
        code: z.string().min(1).optional(),
        state: z.string().min(1).optional(),
        error: z.string().optional(),
      })
      .parse(request.query);
    const state = readMicrosoftState(request);
    void reply.header("Set-Cookie", clearMicrosoftStateCookie());
    if (
      !state ||
      !query.state ||
      state.state !== query.state ||
      query.error !== undefined ||
      !query.code
    ) {
      throw new LoyaltyError("MICROSOFT_AUTH_FAILED", 401);
    }
    const config = await prisma.microsoftAuthConfig.findUnique({
      where: { programId: state.programId },
    });
    if (
      !config?.enabled ||
      config.clientId !== state.clientId ||
      microsoftRedirectUri() !== state.redirectUri
    ) {
      throw new LoyaltyError("MICROSOFT_AUTH_FAILED", 401);
    }
    validateMicrosoftConfig(config);
    const discovery = await discoverMicrosoft(config);
    const identity = await exchangeMicrosoftCode(config, discovery, state, query.code);
    let provisioning: Awaited<ReturnType<typeof resolveMicrosoftMember>>;
    try {
      provisioning = await resolveMicrosoftMember(
        state.programId,
        identity,
        config.autoProvisionMembers,
      );
    } catch (error) {
      void recordAuthAudit(state.programId, null, "failure", "microsoft");
      throw error;
    }
    const session = await lucia.createSession(provisioning.member.id, {});
    const cookie = lucia.createSessionCookie(session.id);
    void reply.header("Set-Cookie", [cookie.serialize(), clearMicrosoftStateCookie()]);
    await prisma.member.update({
      where: { id: provisioning.member.id },
      data: { lastActiveAt: new Date() },
    });
    if (provisioning.outcome === "auto_provisioned_member") {
      void issueOnboardingForMember(state.programId, provisioning.member.id).catch((error: unknown) => {
        request.log.error({ err: error, memberId: provisioning.member.id }, "Failed to issue onboarding campaigns");
      });
    }
    void recordAuthAudit(
      state.programId,
      provisioning.member.id,
      provisioning.outcome,
      "microsoft",
    );
    return reply.redirect(portalHomeUrl());
  });

  /** POST /auth/magic-link — request a sign-in link (always 200 OK) */
  app.post(
    "/auth/magic-link",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      // Kept for existing notification links, but no longer advertised by the
      // customer portal. New customer authentication uses /auth/login.
      void reply.header("Deprecation", "true");
      const { email, locale: requestLocale } = magicLinkSchema.parse(request.body);

      const member = await prisma.member.findFirst({
        where: { email, deletedAt: null, status: "ACTIVE" },
        include: {
          program: { select: { name: true, defaultLocale: true, supportedLocales: true } },
        },
      });

      if (member) {
        const programLocales = member.program.supportedLocales;

        // Single validated locale resolution
        const requestedLocale =
          requestLocale && programLocales.includes(requestLocale) ? requestLocale : undefined;
        const effectiveLocale = requestedLocale ?? member.locale ?? member.program.defaultLocale;

        // Persist locale on first contact
        if (requestedLocale && !member.locale) {
          await prisma.member.update({
            where: { id: member.id },
            data: { locale: requestedLocale },
          });
        }

        const rawToken = generateToken();
        const tokenHash = hashToken(rawToken);

        await prisma.magicLinkToken.create({
          data: {
            memberId: member.id,
            tokenHash,
            expiresAt: new Date(Date.now() + TOKEN_MINUTES * 60_000),
          },
        });

        const baseUrl = resolvePortalUrl().replace(/\/+$/, "");
        const magicLinkUrl = `${baseUrl}/verify?token=${rawToken}`;

        // Fire and forget with locale in context
        void triggerMagicLinkEmail(member.id, member.programId, magicLinkUrl, effectiveLocale);
      } else {
        // No-op for non-existent emails: prevent enumeration
        request.log.info({ email }, "Magic link requested for unknown email");
      }

      return reply.status(200).send({ ok: true });
    },
  );

  /** POST /auth/verify-magic-link — validate token, create session */
  app.post("/auth/verify-magic-link", async (request, reply) => {
    void reply.header("Deprecation", "true");
    const { token } = verifySchema.parse(request.body);
    const tokenHash = hashToken(token);

    const record = await prisma.magicLinkToken.findFirst({
      where: {
        tokenHash,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { member: true },
    });

    if (!record) {
      throw new LoyaltyError("INVALID_TOKEN", 401);
    }
    // Older test fixtures and pre-migration records may not expose status;
    // real migrated members default to ACTIVE in the database.
    if (record.member.status !== "ACTIVE" || record.member.deletedAt) {
      throw new LoyaltyError("MEMBER_INACTIVE", 403);
    }

    // Atomic: mark as consumed
    await prisma.magicLinkToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    const session = await lucia.createSession(record.memberId, {});

    const cookie = lucia.createSessionCookie(session.id);
    void reply.header("Set-Cookie", cookie.serialize());

    return reply.send({
      data: {
        sessionId: session.id,
        expiresAt: session.expiresAt,
        member: {
          id: record.member.id,
          email: record.member.email,
          phone: record.member.phone,
          firstName: record.member.firstName,
          lastName: record.member.lastName,
          programId: record.member.programId,
          joinedAt: record.member.joinedAt,
        },
      },
    });
  });

  /** POST /auth/logout — invalidate current session */
  app.post("/auth/logout", async (request, reply) => {
    for (const sessionId of requestSessionIds(request)) {
      await lucia.invalidateSession(sessionId);
    }

    const blankCookie = lucia.createBlankSessionCookie();
    void reply.header("Set-Cookie", blankCookie.serialize());

    return reply.send({ ok: true });
  });

  /** GET /auth/me — return the currently authenticated member */
  app.get("/auth/me", async (request, reply) => {
    let authenticatedSession: Awaited<ReturnType<typeof lucia.validateSession>> | null = null;
    for (const sessionId of requestSessionIds(request)) {
      const result = await lucia.validateSession(sessionId);
      if (result.user) {
        authenticatedSession = result;
        break;
      }
    }

    if (!authenticatedSession?.user) {
      const blankCookie = lucia.createBlankSessionCookie();
      void reply.header("Set-Cookie", blankCookie.serialize());
      throw new LoyaltyError("UNAUTHORIZED", 401);
    }

    const { session, user } = authenticatedSession;

    // Sliding expiration: refresh cookie if session is fresh (close to expiry)
    if (session.fresh) {
      const freshCookie = lucia.createSessionCookie(session.id);
      void reply.header("Set-Cookie", freshCookie.serialize());
    }

    const member = await prisma.member.findUnique({
      where: { id: user.id },
      include: { program: { select: { defaultLocale: true, supportedLocales: true } } },
    });

    return reply.send({
      data: {
        id: member?.id,
        email: member?.email,
        phone: member?.phone,
        firstName: member?.firstName,
        lastName: member?.lastName,
        joinedAt: member?.joinedAt,
        programId: member?.programId,
        locale: member?.locale ?? null,
        program: member?.program
          ? {
              defaultLocale: member.program.defaultLocale,
              supportedLocales: member.program.supportedLocales,
            }
          : null,
      },
    });
  });

  done();
}
