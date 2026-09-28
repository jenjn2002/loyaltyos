import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  project: { findFirst: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(),
}));
const mockTx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  project: { findFirst: vi.fn(), update: vi.fn() },
  projectBudgetTransaction: { create: vi.fn() },
  projectPointBudget: { update: vi.fn() },
}));

vi.mock("../db.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/audit.js", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/permissions.js", () => ({
  assertCapability: vi.fn().mockResolvedValue(undefined),
  requireCapability: vi.fn(() => async () => undefined),
}));
vi.mock("../lib/wallets.js", () => ({ walletService: { returnProjectBudgetWithTransaction: vi.fn() } }));
vi.mock("../lib/approval-workflows.js", () => ({ createApprovalRequestWithClient: vi.fn() }));

import { LoyaltyError } from "../lib/errors.js";
import { adminProjectsRoutes } from "../routes/admin/projects.js";

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  app = Fastify({ logger: false });
  app.decorateRequest("programId", "");
  app.decorateRequest("memberId", null);
  app.decorateRequest("adminId", null);
  app.decorateRequest("apiKeyScope", "");
  app.decorateRequest("actor", { type: "ADMIN_USER", id: "admin-1" });
  app.addHook("preHandler", async (request) => {
    request.programId = "program-1";
    request.adminId = "admin-1";
    request.actor = { type: "ADMIN_USER", id: "admin-1" };
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof LoyaltyError) {
      return reply.status(error.httpStatus).send({ error: { code: error.code } });
    }
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR" } });
  });
  mockPrisma.$transaction.mockImplementation((callback: (tx: typeof mockTx) => unknown) => callback(mockTx));
  mockTx.$queryRaw.mockResolvedValue([]);
  app.register(adminProjectsRoutes);
  await app.ready();
});

describe("admin project routes", () => {
  it("scopes project detail lookups to the current admin and program", async () => {
    mockPrisma.project.findFirst.mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/admin/projects/project-2" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("PROJECT_NOT_FOUND");
    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "project-2", programId: "program-1", createdByAdminId: "admin-1" },
      }),
    );
  });

  it("allows a rejected issuance project to close and return unused escrow", async () => {
    mockTx.project.findFirst.mockResolvedValue({
      id: "project-1",
      programId: "program-1",
      createdByAdminId: "admin-1",
      status: "ISSUE_REJECTED",
      budgets: [{ id: "budget-1", pointTypeId: "point-1", remainingAmount: 25 }],
    });
    mockTx.project.update.mockResolvedValue({ id: "project-1", status: "CLOSED" });

    const response = await app.inject({ method: "POST", url: "/admin/projects/project-1/close" });

    expect(response.statusCode).toBe(200);
    expect(mockTx.projectPointBudget.update).toHaveBeenCalledWith({
      where: { id: "budget-1" },
      data: { remainingAmount: 0 },
    });
  });
});
