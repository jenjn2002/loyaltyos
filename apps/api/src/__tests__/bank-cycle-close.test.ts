import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  project: { findMany: vi.fn().mockResolvedValue([]) },
  reward: { findMany: vi.fn().mockResolvedValue([]) },
  adminUser: { findMany: vi.fn().mockResolvedValue([]) },
  member: { findMany: vi.fn().mockResolvedValue([]) },
  apiKey: { findMany: vi.fn().mockResolvedValue([]) },
  pointBankCycle: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  pointBank: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  pointBankTransaction: {
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  $transaction: vi.fn(),
}));
const history = vi.hoisted(() => vi.fn());
const mockTx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  pointBankCycle: { findFirst: vi.fn(), update: vi.fn() },
  pointBank: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  pointBankTransaction: { aggregate: vi.fn() },
}));

vi.mock("../db.js", () => ({ prisma: mockPrisma }));
vi.mock("../lib/approval-workflows.js", () => ({
  decideApprovalRequest: vi.fn(),
  ensurePointExchangeApprovalRequest: vi.fn(),
}));
vi.mock("../lib/audit.js", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/created-by.js", () => ({
  createdByForEntities: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("../lib/notifications-setup.js", () => ({
  notificationsService: { sendTrigger: vi.fn() },
}));
vi.mock("../lib/permissions.js", () => ({
  assertCapability: vi.fn().mockResolvedValue(undefined),
  requireCapability: vi.fn(() => async () => undefined),
}));
vi.mock("../lib/wallets.js", () => ({
  BANK_CYCLE_RETURN_TYPES: ["RETURN", "PROJECT_RETURN"],
  walletService: { history },
}));
vi.mock("../lib/workflow-integrations.js", () => ({ pointExchangeApprovalHook: vi.fn() }));
vi.mock("../lib/member-notifications.js", () => ({ notifyCreditExchangeDecision: vi.fn() }));

import { LoyaltyError } from "../lib/errors.js";
import { creditsRoutes } from "../routes/credits.js";

let app: FastifyInstance;

const cycle = {
  id: "cycle-1",
  programId: "program-1",
  pointTypeId: "point-type-1",
  status: "OPEN",
  startsAt: new Date("2026-09-01T00:00:00.000Z"),
  endsAt: new Date("2026-10-01T00:00:00.000Z"),
  opening: 1000,
  allocated: 500,
};

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
  mockPrisma.$transaction.mockImplementation((callback: (tx: typeof mockTx) => unknown) =>
    callback(mockTx),
  );
  mockPrisma.pointBankCycle.findFirst.mockResolvedValue(cycle);
  mockPrisma.pointBankCycle.findMany.mockResolvedValue([]);
  mockPrisma.pointBankTransaction.groupBy.mockResolvedValue([]);
  mockPrisma.pointBankTransaction.findMany.mockResolvedValue([]);
  mockPrisma.pointBankTransaction.count.mockResolvedValue(0);
  mockPrisma.pointBankTransaction.aggregate.mockResolvedValue({ _sum: { amount: -400 } });
  mockTx.$queryRaw.mockResolvedValue([]);
  mockTx.pointBank.findUnique.mockResolvedValue({ id: "bank-1" });
  mockTx.pointBank.findUniqueOrThrow.mockResolvedValue({ balance: 900 });
  mockTx.pointBankCycle.findFirst.mockResolvedValue(cycle);
  mockTx.pointBankCycle.update.mockImplementation(({ data }) => ({ ...cycle, ...data }));
  mockTx.pointBankTransaction.aggregate.mockResolvedValue({ _sum: { amount: -400 } });
  app.register(creditsRoutes);
  await app.ready();
});

describe("bank cycle closing totals", () => {
  it("enriches wallet ledger actors and project source names, and resolves member search within the program", async () => {
    mockPrisma.member.findMany.mockResolvedValueOnce([{ id: "member-1" }]).mockResolvedValueOnce([]);
    mockPrisma.adminUser.findMany.mockResolvedValueOnce([{ id: "admin-1", name: "Admin", email: "admin@example.test" }]);
    mockPrisma.project.findMany.mockResolvedValueOnce([{ id: "project-1", name: "Onboarding" }]);
    history.mockResolvedValueOnce({ items: [{ id: "tx-1", actorId: "admin-1", source: "project:project-1" }], total: 1 });
    const response = await app.inject({ method: "GET", url: "/admin/credits/transactions?member=test%40example.test" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items[0]).toMatchObject({ actor: { name: "Admin", email: "admin@example.test" }, sourceLabel: "Onboarding" });
    expect(history).toHaveBeenCalledWith("program-1", expect.objectContaining({ memberIds: ["member-1"] }));
    expect(mockPrisma.member.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ programId: "program-1", OR: expect.any(Array) }) }));
  });
  it("resolves actor identity and applies date filters to the bank ledger", async () => {
    mockPrisma.adminUser.findMany.mockResolvedValueOnce([{ id: "admin-1", name: "Test Admin", email: "admin@example.test" }]);
    mockPrisma.pointBankTransaction.findMany.mockResolvedValueOnce([{ id: "tx-1", actorId: "admin-1", type: "ISSUANCE", amount: 100, balanceAfter: 900 }]);
    const response = await app.inject({ method: "GET", url: "/admin/credits/bank/transactions?from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.999Z" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items[0].actor).toMatchObject({ name: "Test Admin", email: "admin@example.test", type: "ADMIN_USER" });
    expect(mockPrisma.pointBankTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { programId: "program-1", createdAt: { gte: new Date("2026-09-01T00:00:00.000Z"), lte: new Date("2026-09-30T23:59:59.999Z") } } }));
    expect(mockPrisma.adminUser.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ programId: "program-1" }) }));
  });

  it("rejects inverted bank ledger date ranges", async () => {
    const response = await app.inject({ method: "GET", url: "/admin/credits/bank/transactions?from=2026-09-30T00:00:00Z&to=2026-09-01T00:00:00Z" });
    expect(response.statusCode).toBe(400);
    expect(mockPrisma.pointBankTransaction.findMany).not.toHaveBeenCalled();
  });
  it("shows the net allocation in the cycle list, including existing return transactions", async () => {
    mockPrisma.pointBankCycle.findMany.mockResolvedValue([
      {
        ...cycle,
        pointType: { id: cycle.pointTypeId, code: "P", name: "P-credit", unitLabel: "points" },
        _count: { transactions: 3 },
      },
    ]);
    mockPrisma.pointBankTransaction.groupBy.mockResolvedValue([
      { cycleId: "cycle-1", _sum: { amount: -400 } },
    ]);

    const response = await app.inject({ method: "GET", url: "/admin/credits/bank/cycles" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0].allocated).toBe(400);
  });

  it("shows the net allocation in cycle details", async () => {
    mockPrisma.pointBankCycle.findFirst.mockResolvedValue({
      ...cycle,
      pointType: { id: cycle.pointTypeId, code: "P", name: "P-credit", unitLabel: "points" },
    });
    mockPrisma.pointBankTransaction.aggregate.mockResolvedValue({ _sum: { amount: -400 } });

    const response = await app.inject({
      method: "GET",
      url: "/admin/credits/bank/cycles/cycle-1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.allocated).toBe(400);
  });

  it("excludes transactions after cycle close from closed-cycle details and allocation", async () => {
    const clearedAt = new Date("2026-09-15T12:00:00.000Z");
    mockPrisma.pointBankCycle.findFirst.mockResolvedValue({
      ...cycle,
      status: "CLEARED",
      clearedAt,
      pointType: { id: cycle.pointTypeId, code: "P", name: "P-credit", unitLabel: "points" },
    });
    mockPrisma.pointBankTransaction.aggregate.mockResolvedValue({ _sum: { amount: -300 } });

    const response = await app.inject({ method: "GET", url: "/admin/credits/bank/cycles/cycle-1" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.allocated).toBe(300);
    expect(mockPrisma.pointBankTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [{ OR: [
          { cycleId: "cycle-1", createdAt: { lte: clearedAt } },
          { cycleId: null, createdAt: { gte: cycle.startsAt, lte: clearedAt } },
        ] }],
      }),
    }));
    expect(mockPrisma.pointBankTransaction.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ cycleId: "cycle-1", createdAt: { lte: clearedAt } }),
    }));
  });

  it("limits closed-cycle allocation summaries to transactions recorded before closing", async () => {
    const clearedAt = new Date("2026-09-15T12:00:00.000Z");
    mockPrisma.pointBankCycle.findMany.mockResolvedValue([{
      ...cycle,
      status: "CLEARED",
      clearedAt,
      pointType: { id: cycle.pointTypeId, code: "P", name: "P-credit", unitLabel: "points" },
      _count: { transactions: 4 },
    }]);

    const response = await app.inject({ method: "GET", url: "/admin/credits/bank/cycles" });

    expect(response.statusCode).toBe(200);
    const groupByArgs = mockPrisma.pointBankTransaction.groupBy.mock.calls[0]?.[0];
    expect(groupByArgs.where.AND[1].OR).toContainEqual({ cycleId: "cycle-1", createdAt: { lte: clearedAt } });
  });

  it("closes with debits net of returns", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/credits/bank/cycles/cycle-1/clear",
      payload: { reason: "Close test cycle" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.allocated).toBe(400);
    expect(mockTx.pointBankTransaction.aggregate).toHaveBeenCalledWith({
      where: {
        cycleId: "cycle-1",
        OR: [
          { amount: { lt: 0 } },
          { type: { in: ["RETURN", "PROJECT_RETURN"] }, amount: { gt: 0 } },
        ],
      },
      _sum: { amount: true },
    });
  });

  it("never reports negative allocation when returns exceed debits", async () => {
    mockTx.pointBankTransaction.aggregate.mockResolvedValue({ _sum: { amount: 200 } });

    const response = await app.inject({
      method: "POST",
      url: "/admin/credits/bank/cycles/cycle-1/clear",
      payload: { reason: "Close cycle with net returns" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.allocated).toBe(0);
  });
});
