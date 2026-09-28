import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({ member: { count: vi.fn() } }));
const mockSegments = vi.hoisted(() => ({
  create: vi.fn(), list: vi.fn(), estimateCount: vi.fn(), getById: vi.fn(), update: vi.fn(), delete: vi.fn(),
  count: vi.fn(), getMembers: vi.fn(), addMembers: vi.fn(), removeMembers: vi.fn(),
}));
const mockBadges = vi.hoisted(() => ({
  create: vi.fn(), list: vi.fn(), stats: vi.fn(), getById: vi.fn(), update: vi.fn(), delete: vi.fn(),
}));

vi.mock("../db.js", () => ({ prisma: mockPrisma }));
vi.mock("@loyaltyos/segments", () => ({ SegmentsService: vi.fn(() => mockSegments) }));
vi.mock("@loyaltyos/badges", () => ({ BadgesService: vi.fn(() => mockBadges) }));
vi.mock("../lib/audit.js", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/created-by.js", () => ({ createdByForEntities: vi.fn().mockResolvedValue(new Map()) }));

import { LoyaltyError } from "../lib/errors.js";
import { adminBadgesRoutes } from "../routes/admin/badges.js";
import { adminSegmentsRoutes } from "../routes/admin/segments.js";

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  mockPrisma.member.count.mockResolvedValue(0);
  mockSegments.getById.mockResolvedValue({ id: "foreign-segment", programId: "program-B", type: "STATIC", memberIds: [] });
  mockBadges.getById.mockResolvedValue({ id: "foreign-badge", programId: "program-B" });
  app = Fastify({ logger: false });
  app.decorateRequest("programId", "");
  app.decorateRequest("actor", { type: "ADMIN_USER", id: "admin-A" });
  app.addHook("onRequest", async (request) => { request.programId = "program-A"; });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof LoyaltyError) return reply.status(error.httpStatus).send({ error: { code: error.code } });
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR" } });
  });
  app.register(adminSegmentsRoutes);
  app.register(adminBadgesRoutes);
  await app.ready();
});

describe("program ownership on segment and badge ID routes", () => {
  it.each([
    ["GET", "/admin/segments/foreign-segment", undefined],
    ["PATCH", "/admin/segments/foreign-segment", { name: "Changed" }],
    ["DELETE", "/admin/segments/foreign-segment", undefined],
    ["GET", "/admin/segments/foreign-segment/count", undefined],
    ["GET", "/admin/segments/foreign-segment/members", undefined],
  ] as const)("hides a foreign segment from %s %s", async (method, url, payload) => {
    const response = await app.inject({ method, url, payload });
    expect(response.statusCode).toBe(404);
    expect(mockSegments.update).not.toHaveBeenCalled();
    expect(mockSegments.delete).not.toHaveBeenCalled();
    expect(mockSegments.getMembers).not.toHaveBeenCalled();
  });

  it("does not allow adding another program's member to a local static segment", async () => {
    mockSegments.getById.mockResolvedValue({ id: "local-segment", programId: "program-A", type: "STATIC", memberIds: [] });
    const response = await app.inject({
      method: "POST",
      url: "/admin/segments/local-segment/members",
      payload: { memberIds: ["member-from-B"] },
    });
    expect(response.statusCode).toBe(404);
    expect(mockPrisma.member.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ programId: "program-A", id: { in: ["member-from-B"] } }),
    }));
    expect(mockSegments.addMembers).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", "/admin/badges/foreign-badge", undefined],
    ["PATCH", "/admin/badges/foreign-badge", { name: "Changed" }],
    ["DELETE", "/admin/badges/foreign-badge", undefined],
  ] as const)("hides a foreign badge from %s %s", async (method, url, payload) => {
    const response = await app.inject({ method, url, payload });
    expect(response.statusCode).toBe(404);
    expect(mockBadges.update).not.toHaveBeenCalled();
    expect(mockBadges.delete).not.toHaveBeenCalled();
  });
});
