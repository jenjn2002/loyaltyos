import { createHash } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), transaction: vi.fn(),
  adminUser: vi.fn(), permission: vi.fn(), audit: vi.fn(),
}));
vi.mock("../db.js", () => ({ prisma: {
  program: { findUnique: mocks.findUnique, findFirst: mocks.findFirst, update: mocks.update },
  adminUser: { findFirst: mocks.adminUser },
  adminRolePermission: { findUnique: mocks.permission },
  $transaction: mocks.transaction,
} }));
vi.mock("../lib/audit.js", () => ({ audit: mocks.audit }));

import { adminSettingsRoutes } from "../routes/admin/settings.js";
import { publicBrandingRoutes, programBrandingRoutes } from "../routes/branding.js";
import { systemBrandingResponse } from "../lib/system-branding.js";

const PNG_LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=";
const GIF_LOGO = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
const JPEG_LOGO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==";
const WEBP_LOGO = "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA";
const PNG_LOGO_HASH = createHash("sha256").update(PNG_LOGO).digest("hex");

describe("program-scoped system branding", () => {
  let app: FastifyInstance;
  let name: string;
  let logoUrl: string | null;
  let capabilities: Set<string>;
  const otherProgram = { systemName: "Other Club", logoUrl: GIF_LOGO };
  const tx = { program: { findUnique: mocks.findUnique, update: mocks.update } };

  beforeEach(async () => {
    vi.clearAllMocks();
    name = "LoyaltyOS";
    logoUrl = null;
    capabilities = new Set(["settings.view", "settings.manage"]);
    mocks.findUnique.mockImplementation(async ({ where }) => where.id === "program-a"
      ? { systemName: name, logoUrl }
      : where.id === "program-b" ? { ...otherProgram } : null);
    mocks.findFirst.mockImplementation(async ({ where }) => where.id === "program-a"
      ? { systemName: name, logoUrl, privateSetting: "must-not-leak" }
      : where.id === "program-b" ? { ...otherProgram, privateSetting: "must-not-leak" } : null);
    mocks.update.mockImplementation(async ({ data }) => ({
      systemName: data.systemName,
      logoUrl: data.logoUrl === undefined ? logoUrl : data.logoUrl,
    }));
    mocks.transaction.mockImplementation(async (callback) => {
      const result = await callback(tx);
      name = result.systemName;
      logoUrl = result.logoUrl;
      return result;
    });
    mocks.adminUser.mockResolvedValue({ role: "TEST_ROLE" });
    mocks.permission.mockImplementation(async ({ where }) => ({ allowed: capabilities.has(where.programId_role_capability.capability) }));
    mocks.audit.mockResolvedValue(undefined);
    app = Fastify();
    app.decorateRequest("programId", "program-a");
    app.decorateRequest("adminId", "admin-a");
    app.decorateRequest("apiKeyScope", "SERVER");
    app.decorateRequest("actor", { type: "ADMIN_USER", id: "admin-a" });
    app.setErrorHandler((error, _request, reply) => {
      const status = error instanceof ZodError ? 400 : (error as { httpStatus?: number }).httpStatus ?? 500;
      void reply.status(status).send({ error: { message: error.message } });
    });
    app.register(publicBrandingRoutes);
    app.register(programBrandingRoutes);
    app.register(adminSettingsRoutes);
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it("serves only public branding for an active requested program, without requiring settings permissions", async () => {
    capabilities.clear();
    logoUrl = PNG_LOGO;
    const response = await app.inject({ url: "/auth/branding?programId=program-a" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { systemName: "LoyaltyOS", logoUrl: PNG_LOGO } });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "program-a", isActive: true }, select: { systemName: true, logoUrl: true } });
    expect(mocks.adminUser).not.toHaveBeenCalled();
  });

  it("defaults safely when the public program is missing or unavailable", async () => {
    expect((await app.inject({ url: "/auth/branding" })).json()).toEqual({ data: { systemName: "LoyaltyOS", logoUrl: null } });
    expect((await app.inject({ url: "/auth/branding?programId=unavailable" })).json()).toEqual({ data: { systemName: "LoyaltyOS", logoUrl: null } });
    expect(systemBrandingResponse({ systemName: "   " })).toEqual({ systemName: "LoyaltyOS", logoUrl: null });
  });

  it("returns the requested public program's logo without using another program's branding", async () => {
    logoUrl = PNG_LOGO;
    const response = await app.inject({ url: "/auth/branding?programId=program-b", headers: { "x-program-id": "program-a" } });
    expect(response.json()).toEqual({ data: otherProgram });
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "program-b", isActive: true }, select: { systemName: true, logoUrl: true } });
  });

  it("uses the session program for signed-in reads, ignoring a spoofed program query", async () => {
    name = "Sanboxe Rewards";
    logoUrl = PNG_LOGO;
    const response = await app.inject({ url: "/branding?programId=program-b", headers: { "x-program-id": "program-b" } });
    expect(response.json()).toEqual({ data: { systemName: "Sanboxe Rewards", logoUrl: PNG_LOGO } });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: "program-a" }, select: { systemName: true, logoUrl: true } });
  });

  it("uses the session program for administrative reads", async () => {
    logoUrl = PNG_LOGO;
    const response = await app.inject({ url: "/admin/settings/branding?programId=program-b", headers: { "x-program-id": "program-b" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { systemName: "LoyaltyOS", logoUrl: PNG_LOGO } });
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: "program-a" }, select: { systemName: true, logoUrl: true } });
  });

  it.each(["https://cdn.example.com/logo.png", "http://cdn.example.com/logo.png"])("preserves a safe legacy logo URL on all reads: %s", async (legacyLogoUrl) => {
    logoUrl = legacyLogoUrl;
    for (const url of ["/auth/branding?programId=program-a", "/branding", "/admin/settings/branding"]) {
      const response = await app.inject({ url });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: { systemName: "LoyaltyOS", logoUrl: legacyLogoUrl } });
    }
  });

  it.each([
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "https://user:password@cdn.example.com/logo.png",
    "ftp://cdn.example.com/logo.png",
    "not-a-url",
  ])("hides an unsafe stored logo on all reads: %s", async (unsafeLogoUrl) => {
    logoUrl = unsafeLogoUrl;
    for (const url of ["/auth/branding?programId=program-a", "/branding", "/admin/settings/branding"]) {
      expect((await app.inject({ url })).json()).toEqual({ data: { systemName: "LoyaltyOS", logoUrl: null } });
    }
  });

  it("saves a trimmed Unicode name and audits before/after in the same transaction", async () => {
    const response = await app.inject({ method: "PUT", url: "/admin/settings/branding", payload: { systemName: "  Điểm thưởng Trung Lộc  " } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { systemName: "Điểm thưởng Trung Lộc", logoUrl: null } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "program-a" }, data: { systemName: "Điểm thưởng Trung Lộc" }, select: { systemName: true, logoUrl: true } });
    expect(mocks.audit).toHaveBeenCalledWith("program-a", { type: "ADMIN_USER", id: "admin-a" }, "CONFIG_CHANGE", "program_branding", "program-a", {
      operation: "UPDATE_SYSTEM_NAME",
      before: { systemName: "LoyaltyOS", logoConfigured: false, logoHash: null },
      after: { systemName: "Điểm thưởng Trung Lộc", logoConfigured: false, logoHash: null },
    }, undefined, tx);
    expect((await app.inject({ url: "/auth/branding?programId=program-a" })).json()).toEqual({ data: { systemName: "Điểm thưởng Trung Lộc", logoUrl: null } });
  });

  it.each([
    ["PNG", PNG_LOGO],
    ["JPEG", JPEG_LOGO],
    ["GIF", GIF_LOGO],
    ["WebP", WEBP_LOGO],
  ])("uploads a %s logo and returns it on subsequent reads", async (_format, uploadedLogo) => {
    const response = await app.inject({ method: "PUT", url: "/admin/settings/branding", payload: { systemName: "LoyaltyOS", logoUrl: uploadedLogo } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { systemName: "LoyaltyOS", logoUrl: uploadedLogo } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "program-a" }, data: { systemName: "LoyaltyOS", logoUrl: uploadedLogo }, select: { systemName: true, logoUrl: true } });
    for (const url of ["/auth/branding?programId=program-a", "/branding", "/admin/settings/branding"]) {
      expect((await app.inject({ url })).json()).toEqual({ data: { systemName: "LoyaltyOS", logoUrl: uploadedLogo } });
    }
  });

  it("audits a combined name and logo change with hashes, without copying image data", async () => {
    logoUrl = GIF_LOGO;
    const response = await app.inject({ method: "PUT", url: "/admin/settings/branding", payload: { systemName: "Acme Rewards", logoUrl: PNG_LOGO } });
    expect(response.statusCode).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith("program-a", { type: "ADMIN_USER", id: "admin-a" }, "CONFIG_CHANGE", "program_branding", "program-a", {
      operation: "UPDATE_SYSTEM_BRANDING",
      before: { systemName: "LoyaltyOS", logoConfigured: true, logoHash: createHash("sha256").update(GIF_LOGO).digest("hex") },
      after: { systemName: "Acme Rewards", logoConfigured: true, logoHash: PNG_LOGO_HASH },
    }, undefined, tx);
    const auditDetails = JSON.stringify(mocks.audit.mock.calls[0]![5]);
    expect(auditDetails).not.toContain(PNG_LOGO);
    expect(auditDetails).not.toContain(GIF_LOGO);
    expect(auditDetails).not.toContain("base64");
  });

  it("preserves the latest uploaded logo when a stale name-only client saves", async () => {
    expect((await app.inject({ method: "PUT", url: "/admin/settings/branding", payload: { systemName: "LoyaltyOS", logoUrl: PNG_LOGO } })).statusCode).toBe(200);
    mocks.update.mockClear();
    mocks.audit.mockClear();
    const response = await app.inject({ method: "PUT", url: "/admin/settings/branding", payload: { systemName: "Renamed Club" } });
    expect(response.json()).toEqual({ data: { systemName: "Renamed Club", logoUrl: PNG_LOGO } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "program-a" }, data: { systemName: "Renamed Club" }, select: { systemName: true, logoUrl: true } });
    expect(mocks.audit).toHaveBeenCalledWith("program-a", { type: "ADMIN_USER", id: "admin-a" }, "CONFIG_CHANGE", "program_branding", "program-a", {
      operation: "UPDATE_SYSTEM_NAME",
      before: { systemName: "LoyaltyOS", logoConfigured: true, logoHash: PNG_LOGO_HASH },
      after: { systemName: "Renamed Club", logoConfigured: true, logoHash: PNG_LOGO_HASH },
    }, undefined, tx);
    expect(logoUrl).toBe(PNG_LOGO);
  });

  it("removes the existing logo only when explicit null is supplied", async () => {
    logoUrl = PNG_LOGO;
    const response = await app.inject({ method: "PUT", url: "/admin/settings/branding", payload: { systemName: "LoyaltyOS", logoUrl: null } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { systemName: "LoyaltyOS", logoUrl: null } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "program-a" }, data: { systemName: "LoyaltyOS", logoUrl: null }, select: { systemName: true, logoUrl: true } });
    expect(mocks.audit).toHaveBeenCalledWith("program-a", { type: "ADMIN_USER", id: "admin-a" }, "CONFIG_CHANGE", "program_branding", "program-a", {
      operation: "UPDATE_SYSTEM_BRANDING",
      before: { systemName: "LoyaltyOS", logoConfigured: true, logoHash: PNG_LOGO_HASH },
      after: { systemName: "LoyaltyOS", logoConfigured: false, logoHash: null },
    }, undefined, tx);
    expect((await app.inject({ url: "/auth/branding?programId=program-a" })).json()).toEqual({ data: { systemName: "LoyaltyOS", logoUrl: null } });
  });

  it("scopes logo writes and audits to the session program despite spoofed identifiers", async () => {
    const response = await app.inject({ method: "PUT", url: "/admin/settings/branding?programId=program-b", headers: { "x-program-id": "program-b" }, payload: { programId: "program-b", systemName: "Session Club", logoUrl: PNG_LOGO } });
    expect(response.statusCode).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "program-a" }, data: { systemName: "Session Club", logoUrl: PNG_LOGO }, select: { systemName: true, logoUrl: true } });
    expect(mocks.audit.mock.calls[0]![0]).toBe("program-a");
    expect(mocks.audit.mock.calls[0]![4]).toBe("program-a");
    expect((await app.inject({ url: "/auth/branding?programId=program-b" })).json()).toEqual({ data: otherProgram });
  });

  it("allows read-only settings users to read, but blocks updates", async () => {
    capabilities.delete("settings.manage");
    expect((await app.inject({ url: "/admin/settings/branding" })).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: "/admin/settings/branding", payload: { systemName: "Unauthorized" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/admin/settings/branding", payload: { systemName: "LoyaltyOS", logoUrl: PNG_LOGO } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/admin/settings/branding", payload: { systemName: "LoyaltyOS", logoUrl: null } })).statusCode).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("blocks the administrative read when settings.view is missing", async () => {
    capabilities.delete("settings.view");
    expect((await app.inject({ url: "/admin/settings/branding" })).statusCode).toBe(403);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "x".repeat(81), "Line\nBreak", "Control\u0000Character"])("rejects an invalid name %j without writes", async (systemName) => {
    const response = await app.inject({ method: "PUT", url: "/admin/settings/branding", payload: { systemName } });
    expect(response.statusCode).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    ["SVG", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="],
    ["JavaScript URL", "javascript:alert(1)"],
    ["remote HTTPS URL", "https://cdn.example.com/logo.png"],
    ["remote HTTP URL", "http://cdn.example.com/logo.png"],
    ["unsupported image format", "data:image/bmp;base64,Qk0="],
    ["incorrect PNG signature", "data:image/png;base64,PHN2Zz48L3N2Zz4="],
    ["MIME and signature mismatch", GIF_LOGO.replace("image/gif", "image/png")],
    ["noncanonical base64", PNG_LOGO.slice(0, -1)],
    ["malformed base64", "data:image/png;base64,@@@"],
    ["empty value", ""],
    ["numeric value", 123],
    ["object value", { url: PNG_LOGO }],
  ])("rejects an invalid logo (%s) without writes", async (_reason, invalidLogo) => {
    logoUrl = GIF_LOGO;
    const response = await app.inject({ method: "PUT", url: "/admin/settings/branding", payload: { systemName: "Uncommitted", logoUrl: invalidLogo } });
    expect(response.statusCode).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(name).toBe("LoyaltyOS");
    expect(logoUrl).toBe(GIF_LOGO);
  });

  it("rejects a logo above the size limit without writes", async () => {
    const oversizedLogo = `data:image/png;base64,${Buffer.concat([Buffer.from(PNG_LOGO.split(",")[1]!, "base64"), Buffer.alloc(262_500)]).toString("base64")}`;
    expect(oversizedLogo.length).toBeGreaterThan(350_000);
    const response = await app.inject({ method: "PUT", url: "/admin/settings/branding", payload: { systemName: "LoyaltyOS", logoUrl: oversizedLogo } });
    expect(response.statusCode).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("does not record a false update when the name is unchanged", async () => {
    expect((await app.inject({ method: "PUT", url: "/admin/settings/branding", payload: { systemName: "LoyaltyOS" } })).statusCode).toBe(200);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each([undefined, PNG_LOGO])("does not write or audit when the name and existing logo are unchanged", async (unchangedLogo) => {
    logoUrl = PNG_LOGO;
    const response = await app.inject({ method: "PUT", url: "/admin/settings/branding", payload: { systemName: "  LoyaltyOS  ", ...(unchangedLogo !== undefined ? { logoUrl: unchangedLogo } : {}) } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { systemName: "LoyaltyOS", logoUrl: PNG_LOGO } });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(logoUrl).toBe(PNG_LOGO);
  });

  it("does not write or audit when removing an already absent logo", async () => {
    expect((await app.inject({ method: "PUT", url: "/admin/settings/branding", payload: { systemName: "LoyaltyOS", logoUrl: null } })).statusCode).toBe(200);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("rolls back a rename if its audit fails", async () => {
    mocks.audit.mockRejectedValueOnce(new Error("Audit failed"));
    expect((await app.inject({ method: "PUT", url: "/admin/settings/branding", payload: { systemName: "Uncommitted" } })).statusCode).toBe(500);
    expect(name).toBe("LoyaltyOS");
    expect(logoUrl).toBeNull();
  });

  it.each([PNG_LOGO, null])("rolls back both branding fields if the logo change audit fails", async (newLogo) => {
    logoUrl = GIF_LOGO;
    mocks.audit.mockRejectedValueOnce(new Error("Audit failed"));
    const response = await app.inject({ method: "PUT", url: "/admin/settings/branding", payload: { systemName: "Uncommitted", logoUrl: newLogo } });
    expect(response.statusCode).toBe(500);
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(name).toBe("LoyaltyOS");
    expect(logoUrl).toBe(GIF_LOGO);
    expect((await app.inject({ url: "/auth/branding?programId=program-a" })).json()).toEqual({ data: { systemName: "LoyaltyOS", logoUrl: GIF_LOGO } });
  });
});
