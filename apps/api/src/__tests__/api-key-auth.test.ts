import type { ApiKey } from "@prisma/client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), lastUsed: vi.fn(), list: vi.fn(), findFirst: vi.fn(), create: vi.fn(), revoke: vi.fn(),
  program: vi.fn(), transaction: vi.fn(), admin: vi.fn(), permission: vi.fn(), audit: vi.fn(),
  readAdminCookie: vi.fn(), adminSession: vi.fn(), readMemberCookie: vi.fn(), memberSession: vi.fn(),
}));

vi.mock("../db.js", () => ({ prisma: {
  apiKey: {
    findUnique: mocks.findUnique, update: mocks.lastUsed, findMany: mocks.list,
    findFirst: mocks.findFirst, create: mocks.create, updateMany: mocks.revoke,
  },
  program: { findUnique: mocks.program },
  adminUser: { findFirst: mocks.admin },
  adminRolePermission: { findUnique: mocks.permission },
  $transaction: mocks.transaction,
} }));
vi.mock("../lib/auth/admin-lucia.js", () => ({ adminLucia: {
  readSessionCookie: mocks.readAdminCookie, validateSession: mocks.adminSession,
} }));
vi.mock("../lib/auth/lucia.js", () => ({ lucia: {
  readSessionCookie: mocks.readMemberCookie, validateSession: mocks.memberSession,
} }));
vi.mock("../lib/audit.js", () => ({ audit: mocks.audit }));

import { runApiKeyCommand } from "../../prisma/manage-api-key.mjs";
import { hashApiKeySecret } from "../lib/api-keys.js";
import { LoyaltyError } from "../lib/errors.js";
import { authPlugin } from "../plugins/auth.js";
import { adminApiAccessRoutes } from "../routes/admin/api-access.js";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const MANAGED_SECRET = "los_test_auth_credential";
const LEGACY_SECRET = "legacy_test_auth_credential";
const ADMIN_COOKIE = "loyaltyos_admin_session=admin-session";

function keyRow(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: "managed-key", programId: "program-a", key: hashApiKeySecret(MANAGED_SECRET),
    scope: "SERVER", name: "Managed integration", isActive: true,
    createdAt: NOW, expiresAt: null, lastUsedAt: null, ...overrides,
  };
}

describe("API key authentication and admin guards", () => {
  let app: FastifyInstance;
  let keys: ApiKey[];
  let role: string;
  let permissions: Map<string, boolean>;
  const tx = {
    program: { findUnique: mocks.program },
    apiKey: { create: mocks.create, findFirst: mocks.findFirst, updateMany: mocks.revoke },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    keys = [keyRow(), keyRow({ id: "legacy-key", key: LEGACY_SECRET, name: "Legacy integration" })];
    role = "OPERATOR";
    permissions = new Map();
    mocks.findUnique.mockImplementation(async ({ where }) => keys.find((key) => key.key === where.key) ?? null);
    mocks.lastUsed.mockImplementation(async ({ where, data }) => {
      const key = keys.find((row) => row.id === where.id)!;
      key.lastUsedAt = data.lastUsedAt;
      return key;
    });
    mocks.list.mockImplementation(async ({ where }) => keys.filter((key) => key.programId === where.programId));
    mocks.findFirst.mockImplementation(async ({ where }) => keys.find((key) => key.id === where.id && key.programId === where.programId) ?? null);
    mocks.create.mockImplementation(async ({ data }) => {
      const key = keyRow({ ...data, id: "created-key" });
      keys.push(key);
      return key;
    });
    mocks.revoke.mockImplementation(async ({ where }) => {
      const key = keys.find((row) => row.id === where.id && row.programId === where.programId && row.isActive);
      if (!key) return { count: 0 };
      key.isActive = false;
      return { count: 1 };
    });
    mocks.program.mockResolvedValue({ id: "program-a", isActive: true });
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    mocks.admin.mockImplementation(async ({ where }) => where.id === "admin-a" && where.programId === "program-a" ? { role } : null);
    mocks.permission.mockImplementation(async ({ where }) => {
      const capability = where.programId_role_capability.capability;
      return permissions.has(capability) ? { allowed: permissions.get(capability) } : null;
    });
    mocks.readAdminCookie.mockImplementation((cookie: string) => cookie === ADMIN_COOKIE ? "admin-session" : null);
    mocks.adminSession.mockImplementation(async (session: string) => ({
      user: session === "admin-session" ? { id: "admin-a", programId: "program-a", role } : null,
    }));
    mocks.readMemberCookie.mockReturnValue(null);
    mocks.memberSession.mockResolvedValue({ user: null, session: null });
    mocks.audit.mockResolvedValue(undefined);
    app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      const status = error instanceof ZodError ? 400 : error instanceof LoyaltyError ? error.httpStatus : error.statusCode ?? 500;
      void reply.status(status).send({ error: { message: status === 500 ? "INTERNAL_ERROR" : error.message } });
    });
    await app.register(authPlugin);
    app.get("/api/v1/auth-context", async (request) => ({ data: {
      programId: request.programId, apiKeyScope: request.apiKeyScope,
      adminId: request.adminId, memberId: request.memberId, actor: request.actor,
    } }));
    app.get("/api/v1/admin/members", async () => ({ data: [] }));
    await app.register(adminApiAccessRoutes, { prefix: "/api/v1" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("authenticates a managed secret by its digest and stamps the API actor context", async () => {
    const response = await app.inject({ url: "/api/v1/auth-context", headers: { "x-api-key": MANAGED_SECRET, "x-program-id": "program-a" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: {
      programId: "program-a", apiKeyScope: "SERVER", adminId: null, memberId: null,
      actor: { type: "API_KEY", id: "managed-key" },
    } });
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { key: hashApiKeySecret(MANAGED_SECRET) } });
    expect(mocks.lastUsed).toHaveBeenCalledWith({ where: { id: "managed-key" }, data: { lastUsedAt: NOW } });
    expect(response.body).not.toContain(MANAGED_SECRET);
    expect(response.body).not.toContain("sha256:");
  });

  it("retains legacy plaintext credentials after a digest lookup misses", async () => {
    const response = await app.inject({ url: "/api/v1/auth-context", headers: { "x-api-key": LEGACY_SECRET } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.actor).toEqual({ type: "API_KEY", id: "legacy-key" });
    expect(mocks.findUnique).toHaveBeenNthCalledWith(1, { where: { key: hashApiKeySecret(LEGACY_SECRET) } });
    expect(mocks.findUnique).toHaveBeenNthCalledWith(2, { where: { key: LEGACY_SECRET } });
    expect(mocks.lastUsed).toHaveBeenCalledWith({ where: { id: "legacy-key" }, data: { lastUsedAt: NOW } });
  });

  it("rejects a submitted database digest before any key lookup or usage update", async () => {
    const response = await app.inject({ url: "/api/v1/auth-context", headers: { "x-api-key": hashApiKeySecret(MANAGED_SECRET) } });
    expect(response.statusCode).toBe(401);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.lastUsed).not.toHaveBeenCalled();
  });

  it("preserves production rejection of the public development key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    keys.push(keyRow({ id: "public-key", key: "dev-key" }));
    const response = await app.inject({ url: "/api/v1/auth-context", headers: { "x-api-key": "dev-key" } });
    expect(response.statusCode).toBe(401);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.lastUsed).not.toHaveBeenCalled();
  });

  it.each(["revoked", "expired", "wrong-program"])("rejects a %s managed credential without recording usage", async (condition) => {
    if (condition === "revoked") keys[0]!.isActive = false;
    if (condition === "expired") keys[0]!.expiresAt = new Date(NOW.getTime() - 1);
    const response = await app.inject({ url: "/api/v1/auth-context", headers: {
      "x-api-key": MANAGED_SECRET,
      ...(condition === "wrong-program" ? { "x-program-id": "program-b" } : {}),
    } });
    expect(response.statusCode).toBe(condition === "wrong-program" ? 403 : 401);
    expect(mocks.lastUsed).not.toHaveBeenCalled();
  });

  it("does not fall back to a plaintext credential when the matching digest is revoked", async () => {
    keys[0]!.isActive = false;
    keys.push(keyRow({ id: "plaintext-collision", key: MANAGED_SECRET, isActive: true }));
    const response = await app.inject({ url: "/api/v1/auth-context", headers: { "x-api-key": MANAGED_SECRET } });
    expect(response.statusCode).toBe(401);
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.lastUsed).not.toHaveBeenCalled();
  });

  it("preserves ordinary admin access for SERVER credentials", async () => {
    const response = await app.inject({ url: "/api/v1/admin/members", headers: { "x-api-key": MANAGED_SECRET } });
    expect(response.statusCode).toBe(200);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each(["GET", "POST", "DELETE"] as const)("forbids SERVER API actors from key management through %s", async (method) => {
    const response = await app.inject({ method,
      url: method === "DELETE" ? "/api/v1/admin/settings/api-keys/managed-key" : "/api/v1/admin/settings/api-keys",
      headers: { "x-api-key": MANAGED_SECRET },
      ...(method === "POST" ? { payload: { name: "Forbidden", scope: "SERVER" } } : {}),
    });
    expect(response.statusCode).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each(["GET", "HEAD"] as const)("allows a manage-only admin session to list keys through the global %s guard", async (method) => {
    permissions.set("api_key.view", false);
    permissions.set("api_key.manage", true);
    permissions.set("settings.view", false);
    const response = await app.inject({ method, url: "/api/v1/admin/settings/api-keys?programId=program-b", headers: {
      cookie: ADMIN_COOKIE, "x-api-key": "ignored-secret", "x-program-id": "program-b",
    } });
    expect(response.statusCode).toBe(200);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ where: { programId: "program-a" } }));
    if (method === "GET") {
      expect(response.json().data.keys).toHaveLength(2);
      expect(response.body).not.toContain("sha256:");
      expect(response.body).not.toContain(LEGACY_SECRET);
    }
  });

  it("allows api_key.view alone to list but not mint or revoke", async () => {
    permissions.set("api_key.view", true);
    const headers = { cookie: ADMIN_COOKIE };
    expect((await app.inject({ url: "/api/v1/admin/settings/api-keys", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/settings/api-keys", headers, payload: { name: "Forbidden", scope: "SERVER" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: "/api/v1/admin/settings/api-keys/managed-key", headers })).statusCode).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(["ungranted", "settings-manage-only"])("prevents a %s admin session from listing or minting keys", async (mode) => {
    if (mode === "settings-manage-only") permissions.set("settings.manage", true);
    const headers = { cookie: ADMIN_COOKIE };
    expect((await app.inject({ url: "/api/v1/admin/settings/api-keys", headers })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/settings/api-keys", headers, payload: { name: "Forbidden", scope: "SERVER" } })).statusCode).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("permits a granted manager to mint a hashed credential through both authorization layers", async () => {
    permissions.set("api_key.manage", true);
    permissions.set("settings.manage", false);
    const response = await app.inject({ method: "POST", url: "/api/v1/admin/settings/api-keys", headers: { cookie: ADMIN_COOKIE }, payload: { name: "Allowed integration", scope: "CLIENT" } });
    expect(response.statusCode).toBe(201);
    const secret = response.json().data.secret;
    expect(mocks.create.mock.calls[0]![0].data.key).toBe(hashApiKeySecret(secret));
    expect(mocks.audit.mock.calls[0]![1]).toEqual({ type: "ADMIN_USER", id: "admin-a" });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["SUPER_ADMIN", 201], ["OPERATOR", 403], ["ANALYST", 403], ["CUSTOM_ROLE", 403],
  ])("defaults role %s to creation status %s without overrides", async (adminRole, status) => {
    role = adminRole as string;
    const response = await app.inject({ method: "POST", url: "/api/v1/admin/settings/api-keys", headers: { cookie: ADMIN_COOKIE }, payload: { name: "Role integration", scope: "SERVER" } });
    expect(response.statusCode).toBe(status);
    expect(mocks.create).toHaveBeenCalledTimes(status === 201 ? 1 : 0);
  });
});

describe("CLI API key creation compatibility", () => {
  it("returns the one-time secret while persisting its matching hash and selecting only metadata", async () => {
    const program = vi.fn().mockResolvedValue({ id: "program-a", isActive: true });
    const create = vi.fn().mockImplementation(async ({ data }) => {
      const { key: _key, ...metadata } = keyRow({ ...data, id: "cli-key" });
      return metadata;
    });
    const result = await runApiKeyCommand({ program: { findUnique: program }, apiKey: { create } }, {
      command: "create", environment: "sandbox", programId: "program-a", name: "CLI integration", scope: "SERVER", days: 90,
    });
    const secret = result.data.key;
    expect(secret).toMatch(/^los_[A-Za-z0-9_-]{43}$/);
    expect(create.mock.calls[0]![0].data.key).toBe(hashApiKeySecret(secret));
    expect(create.mock.calls[0]![0].select).not.toHaveProperty("key");
    expect(create.mock.calls[0]![0].select).toMatchObject({ id: true, programId: true, name: true, scope: true, isActive: true, expiresAt: true, lastUsedAt: true, createdAt: true });
    expect(result.data).toMatchObject({ id: "cli-key", programId: "program-a", name: "CLI integration", scope: "SERVER", key: secret });
    expect(JSON.stringify(result)).not.toContain(hashApiKeySecret(secret));
  });
});
