import rateLimit from "@fastify/rate-limit";
import type { ApiKey } from "@prisma/client";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  program: vi.fn(), list: vi.fn(), findKey: vi.fn(), create: vi.fn(), revoke: vi.fn(),
  transaction: vi.fn(), admin: vi.fn(), permission: vi.fn(), audit: vi.fn(),
}));
vi.mock("../db.js", () => ({ prisma: {
  program: { findUnique: mocks.program },
  apiKey: { findMany: mocks.list, findFirst: mocks.findKey, create: mocks.create, updateMany: mocks.revoke },
  adminUser: { findFirst: mocks.admin },
  adminRolePermission: { findUnique: mocks.permission },
  $transaction: mocks.transaction,
} }));
vi.mock("../lib/audit.js", () => ({ audit: mocks.audit }));

import { API_KEY_METADATA_SELECT, apiKeyMetadata, createApiKeyCredentials, hashApiKeySecret } from "../lib/api-keys.js";
import { LoyaltyError } from "../lib/errors.js";
import { adminApiAccessRoutes } from "../routes/admin/api-access.js";

const NOW = new Date("2026-10-07T12:00:00.000Z");
function keyRow(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: "key-a", programId: "program-a", key: "legacy-test-credential", name: "Warehouse",
    scope: "SERVER", isActive: true, createdAt: NOW, expiresAt: null, lastUsedAt: null,
    ...overrides,
  };
}

describe("managed API key credential helpers", () => {
  it("generates separate random secrets and stores only a SHA256 digest", () => {
    const first = createApiKeyCredentials();
    const second = createApiKeyCredentials();
    expect(first.secret).toMatch(/^los_[A-Za-z0-9_-]{43}$/);
    expect(first.secret).not.toBe(second.secret);
    expect(first.keyHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.keyHash).toBe(hashApiKeySecret(first.secret));
    expect(hashApiKeySecret("abc")).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("copies only credential-free metadata even from a complete key record", () => {
    const metadata = apiKeyMetadata(keyRow());
    expect(Object.keys(metadata).sort()).toEqual(Object.keys(API_KEY_METADATA_SELECT).sort());
    expect(metadata).not.toHaveProperty("key");
    expect(metadata).not.toHaveProperty("programId");
  });
});

describe("program API access settings", () => {
  let app: FastifyInstance;
  let keys: ApiKey[];
  let capabilities: Set<string>;
  let identity: "admin" | "server-key" | "member" | "spoofed-admin";
  let program: { id: string; isActive: boolean } | null;
  const tx = {
    program: { findUnique: mocks.program },
    apiKey: { findFirst: mocks.findKey, create: mocks.create, updateMany: mocks.revoke },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    keys = [keyRow(), keyRow({ id: "key-b", programId: "program-b", key: "foreign-test-credential" })];
    capabilities = new Set(["settings.view", "api_key.view", "api_key.manage"]);
    identity = "admin";
    program = { id: "program-a", isActive: true };
    mocks.program.mockImplementation(async ({ where }) => where.id === "program-a" ? program : null);
    // Deliberately return complete rows to check the public projection too.
    mocks.list.mockImplementation(async ({ where }) => keys.filter((key) => key.programId === where.programId));
    mocks.findKey.mockImplementation(async ({ where }) => keys.find((key) => key.id === where.id && key.programId === where.programId) ?? null);
    mocks.create.mockImplementation(async ({ data }) => {
      const row = keyRow({ ...data, id: "new-key" });
      keys.push(row);
      return row;
    });
    mocks.revoke.mockImplementation(async ({ where }) => {
      const key = keys.find((row) => row.id === where.id && row.programId === where.programId && row.isActive);
      if (!key) return { count: 0 };
      key.isActive = false;
      return { count: 1 };
    });
    mocks.transaction.mockImplementation(async (callback) => {
      const before = keys.map((key) => ({ ...key }));
      try { return await callback(tx); }
      catch (error) { keys = before; throw error; }
    });
    mocks.admin.mockResolvedValue({ role: "TEST_ROLE" });
    mocks.permission.mockImplementation(async ({ where }) => ({ allowed: capabilities.has(where.programId_role_capability.capability) }));
    mocks.audit.mockResolvedValue(undefined);
    app = Fastify();
    app.decorateRequest("programId", "program-a");
    app.decorateRequest("adminId", null);
    app.decorateRequest("apiKeyScope", "SERVER");
    app.decorateRequest("actor", null);
    app.addHook("onRequest", (request, _reply, next) => {
      request.adminId = identity === "admin" || identity === "spoofed-admin" ? "admin-a" : null;
      request.apiKeyScope = identity === "member" ? "MEMBER" : "SERVER";
      request.actor = identity === "admin" ? { type: "ADMIN_USER", id: "admin-a" }
        : identity === "member" ? { type: "MEMBER", id: "member-a" } : { type: "API_KEY", id: "api-key-a" };
      next();
    });
    app.setErrorHandler((error, _request, reply) => {
      const status = error instanceof ZodError ? 400 : error instanceof LoyaltyError ? error.httpStatus : error.statusCode ?? 500;
      void reply.status(status).send({ error: { code: status === 500 ? "INTERNAL_ERROR" : error.message } });
    });
    await app.register(rateLimit, {
      max: 1000,
      timeWindow: "1 minute",
      keyGenerator: (request) => (request.headers["x-api-key"] as string | undefined) ?? request.ip,
    });
    app.register(adminApiAccessRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns the authenticated program and environment, ignoring spoofed identifiers", async () => {
    vi.stubEnv("LOYALTYOS_ENVIRONMENT", "sandbox");
    const response = await app.inject({ url: "/admin/settings/api-access?programId=program-b", headers: { "x-program-id": "program-b" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { programId: "program-a", environment: "sandbox", apiBasePath: "/api/v1" } });
    expect(mocks.program).toHaveBeenCalledWith({ where: { id: "program-a" }, select: { id: true } });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("rejects a missing program and a settings read without settings.view", async () => {
    program = null;
    expect((await app.inject({ url: "/admin/settings/api-access" })).statusCode).toBe(404);
    capabilities.delete("settings.view");
    mocks.program.mockClear();
    expect((await app.inject({ url: "/admin/settings/api-access" })).statusCode).toBe(403);
    expect(mocks.program).not.toHaveBeenCalled();
  });

  it("lists only this program's metadata, including revoked and expired keys", async () => {
    keys.push(keyRow({ id: "expired-key", isActive: false, expiresAt: new Date("2020-01-01") }));
    const response = await app.inject({ url: "/admin/settings/api-keys?programId=program-b", headers: { "x-program-id": "program-b" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.keys.map((key: { id: string }) => key.id)).toEqual(["key-a", "expired-key"]);
    expect(response.body).not.toContain("credential");
    expect(response.body).not.toContain("sha256:");
    expect(response.json().data.keys.every((key: object) => !Object.hasOwn(key, "key") && !Object.hasOwn(key, "programId"))).toBe(true);
    expect(mocks.list).toHaveBeenCalledWith({
      where: { programId: "program-a" }, select: API_KEY_METADATA_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });

  it.each(["api_key.view", "api_key.manage"])("allows a list with only %s, independent of settings.view", async (capability) => {
    capabilities = new Set([capability]);
    expect((await app.inject({ url: "/admin/settings/api-keys" })).statusCode).toBe(200);
  });

  it("rejects key metadata reads without either key permission", async () => {
    capabilities = new Set(["settings.view", "settings.manage"]);
    expect((await app.inject({ url: "/admin/settings/api-keys" })).statusCode).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it.each(["server-key", "member", "spoofed-admin"] as const)("requires an actual admin session for all key operations (%s)", async (mode) => {
    identity = mode;
    for (const method of ["GET", "POST", "DELETE"] as const) {
      const response = await app.inject({ method, url: method === "DELETE" ? "/admin/settings/api-keys/key-a" : "/admin/settings/api-keys",
        ...(method === "POST" ? { payload: { name: "Forbidden", scope: "SERVER" } } : {}),
      });
      expect(response.statusCode).toBe(403);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(["CLIENT", "SERVER"])("creates a %s key once with a trimmed label, hashed storage and atomic audit", async (scope) => {
    const response = await app.inject({ method: "POST", url: "/admin/settings/api-keys?programId=program-b", headers: { "x-program-id": "program-b" }, payload: { name: "  Điểm tích hợp  ", scope } });
    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.pragma).toBe("no-cache");
    const { secret, key } = response.json().data;
    expect(secret).toMatch(/^los_[A-Za-z0-9_-]{43}$/);
    expect(key).toMatchObject({ id: "new-key", name: "Điểm tích hợp", scope, isActive: true, expiresAt: "2027-01-05T12:00:00.000Z" });
    expect(key).not.toHaveProperty("key");
    expect(key).not.toHaveProperty("programId");
    expect(mocks.create).toHaveBeenCalledWith({ data: {
      programId: "program-a", name: "Điểm tích hợp", scope, key: hashApiKeySecret(secret),
      isActive: true, expiresAt: new Date("2027-01-05T12:00:00.000Z"),
    }, select: API_KEY_METADATA_SELECT });
    expect(keys.find((row) => row.id === "new-key")!.key).toBe(hashApiKeySecret(secret));
    expect(mocks.audit).toHaveBeenCalledWith("program-a", { type: "ADMIN_USER", id: "admin-a" }, "CONFIG_CHANGE", "api_key", "new-key", {
      operation: "CREATE_API_KEY", programId: "program-a", name: "Điểm tích hợp", scope, expiresAt: "2027-01-05T12:00:00.000Z",
    }, undefined, tx);
    const auditMetadata = JSON.stringify(mocks.audit.mock.calls[0]![5]);
    expect(auditMetadata).not.toContain(secret);
    expect(auditMetadata).not.toContain(hashApiKeySecret(secret));
    const listed = await app.inject({ url: "/admin/settings/api-keys" });
    expect(listed.body).not.toContain(secret);
    expect(listed.body).not.toContain(hashApiKeySecret(secret));
  });

  it.each([null, 1, 3650])("accepts explicit lifetime %s", async (expiresInDays) => {
    const response = await app.inject({ method: "POST", url: "/admin/settings/api-keys", payload: { name: "Integration", scope: "CLIENT", expiresInDays } });
    expect(response.statusCode).toBe(201);
    expect(response.json().data.key.expiresAt).toBe(expiresInDays === null ? null : new Date(NOW.getTime() + expiresInDays * 86_400_000).toISOString());
  });

  it.each([
    { name: "", scope: "CLIENT" }, { name: "   ", scope: "CLIENT" },
    { name: "x".repeat(121), scope: "CLIENT" }, { name: "Line\nBreak", scope: "CLIENT" },
    { name: "\tIntegration", scope: "CLIENT" }, { name: "Integration\u0000", scope: "CLIENT" },
    { name: "Integration" }, { name: "Integration", scope: "ADMIN" },
    { name: "Integration", scope: "CLIENT", expiresInDays: 0 },
    { name: "Integration", scope: "CLIENT", expiresInDays: 3651 },
    { name: "Integration", scope: "CLIENT", expiresInDays: 1.5 },
    { name: "Integration", scope: "CLIENT", expiresInDays: "90" },
    { name: "Integration", scope: "CLIENT", programId: "program-b" },
    { name: "Integration", scope: "CLIENT", key: "chosen-secret" },
    { name: "Integration", scope: "CLIENT", isActive: true },
    { name: "Integration", scope: "CLIENT", expiresAt: null },
  ])("rejects invalid or unknown creation fields without issuing a key: %j", async (payload) => {
    const response = await app.inject({ method: "POST", url: "/admin/settings/api-keys", payload });
    expect(response.statusCode).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("requires key management permission for create and revoke", async () => {
    capabilities = new Set(["settings.view", "settings.manage", "api_key.view"]);
    expect((await app.inject({ method: "POST", url: "/admin/settings/api-keys", payload: { name: "Integration", scope: "SERVER" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: "/admin/settings/api-keys/key-a" })).statusCode).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("limits creation to ten requests per minute even when the API key header changes", async () => {
    for (let index = 0; index < 10; index += 1) {
      const response = await app.inject({ method: "POST", url: "/admin/settings/api-keys", headers: { "x-api-key": `test-header-${index}` }, payload: {} });
      expect(response.statusCode).toBe(400);
    }
    const limited = await app.inject({ method: "POST", url: "/admin/settings/api-keys", headers: { "x-api-key": "different-test-header" }, payload: { name: "Limited", scope: "SERVER" } });
    expect(limited.statusCode).toBe(429);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("prevents issuing keys for missing or inactive programs", async () => {
    program = null;
    expect((await app.inject({ method: "POST", url: "/admin/settings/api-keys", payload: { name: "Integration", scope: "SERVER" } })).statusCode).toBe(404);
    program = { id: "program-a", isActive: false };
    expect((await app.inject({ method: "POST", url: "/admin/settings/api-keys", payload: { name: "Integration", scope: "SERVER" } })).statusCode).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("rolls back an issued key when audit fails and never returns its secret or hash", async () => {
    mocks.audit.mockRejectedValueOnce(new Error("Audit unavailable"));
    const response = await app.inject({ method: "POST", url: "/admin/settings/api-keys", payload: { name: "Integration", scope: "SERVER" } });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: "INTERNAL_ERROR" } });
    expect(keys).toHaveLength(2);
    expect(response.body).not.toContain("los_");
    expect(response.body).not.toContain("sha256:");
  });

  it("soft revokes only this program's key and audits once", async () => {
    const response = await app.inject({ method: "DELETE", url: "/admin/settings/api-keys/key-a?programId=program-b", headers: { "x-program-id": "program-b" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.key).toMatchObject({ id: "key-a", isActive: false });
    expect(response.body).not.toContain("credential");
    expect(mocks.revoke).toHaveBeenCalledWith({ where: { id: "key-a", programId: "program-a", isActive: true }, data: { isActive: false } });
    expect(mocks.audit).toHaveBeenCalledWith("program-a", { type: "ADMIN_USER", id: "admin-a" }, "CONFIG_CHANGE", "api_key", "key-a", {
      operation: "REVOKE_API_KEY", programId: "program-a", name: "Warehouse", scope: "SERVER", expiresAt: null,
    }, undefined, tx);
    expect(keys.find((key) => key.id === "key-b")!.isActive).toBe(true);
    expect(keys).toHaveLength(2);
    const repeated = await app.inject({ method: "DELETE", url: "/admin/settings/api-keys/key-a" });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().data.key.isActive).toBe(false);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.revoke).toHaveBeenCalledTimes(1);
  });

  it("returns the same 404 for a missing key and another program's key", async () => {
    for (const id of ["missing-key", "key-b"]) {
      const response = await app.inject({ method: "DELETE", url: `/admin/settings/api-keys/${id}` });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: { code: "API_KEY_NOT_FOUND" } });
    }
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("does not duplicate an audit when another request already revoked the key", async () => {
    mocks.revoke.mockImplementationOnce(async () => {
      keys[0]!.isActive = false;
      return { count: 0 };
    });
    const response = await app.inject({ method: "DELETE", url: "/admin/settings/api-keys/key-a" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.key.isActive).toBe(false);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("rolls back a revocation when its audit cannot be recorded", async () => {
    mocks.audit.mockRejectedValueOnce(new Error("Audit unavailable"));
    const response = await app.inject({ method: "DELETE", url: "/admin/settings/api-keys/key-a" });
    expect(response.statusCode).toBe(500);
    expect(keys[0]!.isActive).toBe(true);
    expect(response.body).not.toContain("credential");
  });
});
