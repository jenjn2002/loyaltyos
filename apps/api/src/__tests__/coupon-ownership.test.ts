import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCoupons = vi.hoisted(() => ({
  validate: vi.fn(),
  redeem: vi.fn(),
}));

vi.mock("@loyaltyos/coupons", () => ({
  CouponsService: vi.fn().mockImplementation(() => mockCoupons),
}));
vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../lib/business-metrics.js", () => ({
  adaptCouponsMetrics: vi.fn(() => ({})),
  getBusinessMetrics: vi.fn(() => ({})),
}));

import { LoyaltyError } from "../lib/errors.js";
import { couponsRoutes } from "../routes/coupons.js";

let app: FastifyInstance;
let identity: { memberId: string | null; adminId: string | null; apiKeyScope: string; actorType: string };

beforeEach(async () => {
  vi.clearAllMocks();
  identity = { memberId: "member-1", adminId: null, apiKeyScope: "MEMBER", actorType: "MEMBER" };
  app = Fastify({ logger: false });
  app.decorateRequest("programId", "program-1");
  app.decorateRequest("memberId", null);
  app.decorateRequest("adminId", null);
  app.decorateRequest("apiKeyScope", "");
  app.decorateRequest("actor", { type: "SYSTEM", id: "anonymous" });
  app.addHook("onRequest", async (request) => {
    request.programId = "program-1";
    request.memberId = identity.memberId;
    request.adminId = identity.adminId;
    request.apiKeyScope = identity.apiKeyScope;
    request.actor = { type: identity.actorType as "MEMBER", id: "member-1" };
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof LoyaltyError) return reply.status(error.httpStatus).send({ error: { code: error.code } });
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR" } });
  });
  app.register(couponsRoutes);
  await app.ready();
  mockCoupons.validate.mockResolvedValue({ valid: true });
  mockCoupons.redeem.mockResolvedValue({ redemptionId: "redemption-1" });
});

describe("coupon member ownership", () => {
  it.each(["validate", "redeem"] as const)("does not let a member use another member's identity for %s", async (action) => {
    const response = await app.inject({
      method: "POST",
      url: `/coupons/${action}`,
      payload: { code: "SAVE10", memberId: "member-2" },
    });

    expect(response.statusCode).toBe(403);
    expect(action === "validate" ? mockCoupons.validate : mockCoupons.redeem).not.toHaveBeenCalled();
  });

  it("allows a member to validate a coupon for their own account", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/coupons/validate",
      payload: { code: "SAVE10", memberId: "member-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockCoupons.validate).toHaveBeenCalledWith("SAVE10", expect.objectContaining({ programId: "program-1", memberId: "member-1" }));
  });
});
