import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCoalition = vi.hoisted(() => ({
  accumulate: vi.fn(),
  redeem: vi.fn(),
  convert: vi.fn(),
  reverseCoalitionTransaction: vi.fn(),
  getExternalBalance: vi.fn(),
  getExternalHistory: vi.fn(),
}));
const mockCache = vi.hoisted(() => vi.fn());

vi.mock("../lib/coalition-setup.js", () => ({
  coalitionService: mockCoalition,
  getCachedExternalBalance: mockCache,
}));

import { LoyaltyError } from "../lib/errors.js";
import { coalitionRoutes } from "../routes/coalition.js";

let app: FastifyInstance;
let identity: { apiKeyScope: string; actorType: string };

beforeEach(async () => {
  vi.clearAllMocks();
  identity = { apiKeyScope: "MEMBER", actorType: "MEMBER" };
  app = Fastify({ logger: false });
  app.decorateRequest("programId", "");
  app.decorateRequest("memberId", null);
  app.decorateRequest("adminId", null);
  app.decorateRequest("apiKeyScope", "");
  app.decorateRequest("actor", { type: "SYSTEM", id: "anonymous" });
  app.addHook("onRequest", async (request) => {
    request.programId = "program-1";
    request.memberId = "member-1";
    request.apiKeyScope = identity.apiKeyScope;
    request.actor = { type: identity.actorType as "MEMBER", id: "member-1" };
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof LoyaltyError) return reply.status(error.httpStatus).send({ error: { code: error.code } });
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR" } });
  });
  app.register(coalitionRoutes);
  await app.ready();
});

describe("coalition integration authorization", () => {
  it("rejects a member session attempting a coalition transaction for another member", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/coalition/redeem",
      headers: { "idempotency-key": "member-redeem-1" },
      payload: {
        memberId: "member-2",
        externalMemberRef: "external-2",
        points: 100,
        txRef: "tx-1",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(mockCoalition.redeem).not.toHaveBeenCalled();
  });

  it("rejects member sessions from reading another member's coalition balance", async () => {
    const response = await app.inject({ method: "GET", url: "/members/member-2/coalition/balance" });

    expect(response.statusCode).toBe(403);
    expect(mockCoalition.getExternalBalance).not.toHaveBeenCalled();
    expect(mockCache).not.toHaveBeenCalled();
  });

  it("allows a trusted server API key to read a member's coalition balance", async () => {
    identity = { apiKeyScope: "SERVER", actorType: "API_KEY" };
    mockCache.mockResolvedValue(400);

    const response = await app.inject({ method: "GET", url: "/members/member-2/coalition/balance" });

    expect(response.statusCode).toBe(200);
    expect(mockCache).toHaveBeenCalledWith("program-1", "member-2", expect.any(Function));
  });
});
