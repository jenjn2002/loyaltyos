import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  eventDefinition: { findMany: vi.fn(), findUnique: vi.fn() },
  event: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  member: { findFirst: vi.fn() },
  campaign: { findFirst: vi.fn(), findMany: vi.fn() },
  campaignApplication: { count: vi.fn(), aggregate: vi.fn() },
  campaignClaim: { count: vi.fn(), aggregate: vi.fn() },
}));

vi.mock("../db.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/audit.js", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/occasion-issuance.js", () => ({ issueOccasion: vi.fn() }));
vi.mock("../lib/notifications-setup.js", () => ({ notificationsService: { sendTrigger: vi.fn() } }));

import { checkInRoutes } from "../routes/check-ins.js";
import { issueOccasion } from "../lib/occasion-issuance.js";

let app: FastifyInstance;

const definition = {
  id: "event-1",
  programId: "program-1",
  key: "daily-check-in",
  name: "Daily check-in",
  isActive: true,
  automation: { mode: "MEMBER_CHECK_IN", timezone: "UTC" },
};

beforeEach(async () => {
  vi.clearAllMocks();
  app = Fastify({ logger: false });
  app.decorateRequest("programId", "");
  app.decorateRequest("memberId", null);
  app.decorateRequest("adminId", null);
  app.decorateRequest("apiKeyScope", "");
  app.decorateRequest("actor", { type: "MEMBER", id: "member-1" });
  app.addHook("preHandler", async (request) => {
    request.programId = "program-1";
    request.memberId = "member-1";
    request.actor = { type: "MEMBER", id: "member-1" };
  });
  app.register(checkInRoutes);
  mockPrisma.eventDefinition.findMany.mockResolvedValue([definition]);
  mockPrisma.eventDefinition.findUnique.mockResolvedValue(definition);
  mockPrisma.event.findMany.mockResolvedValue([]);
  mockPrisma.member.findFirst.mockResolvedValue({ id: "member-1", status: "ACTIVE", deletedAt: null });
  mockPrisma.campaign.findFirst.mockResolvedValue({ id: "campaign-1" });
  mockPrisma.campaign.findMany.mockResolvedValue([
    {
      id: "campaign-1",
      name: "Daily check-in reward",
      segmentId: null,
      pointTypeId: "point-1",
      conditions: {},
      multiplier: 100,
      maxUsesPerMember: null,
      maxBudget: null,
      issuanceMode: "AUTO",
      pointType: { id: "point-1", code: "P", name: "P-credit", unitLabel: "points" },
    },
  ]);
  await app.ready();
});

describe("member check-in routes", () => {
  it("shows an active check-in campaign and enables today's check-in", async () => {
    const response = await app.inject({ method: "GET", url: "/members/me/check-ins" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.events).toEqual([
      expect.objectContaining({
        key: "daily-check-in",
        canCheckIn: true,
        checkedInToday: false,
        campaigns: [expect.objectContaining({ id: "campaign-1", points: 100 })],
      }),
    ]);
  });

  it("does not issue twice when today's event has already been processed", async () => {
    mockPrisma.event.findUnique.mockResolvedValue({ id: "check-in-event-1", processed: true });

    const response = await app.inject({
      method: "POST",
      url: "/members/me/check-ins/daily-check-in",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      eventKey: "daily-check-in",
      alreadyCheckedIn: true,
      rewards: [],
    });
    expect(issueOccasion).not.toHaveBeenCalled();
  });
});
