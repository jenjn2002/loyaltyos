import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  project: { findFirst: vi.fn(), findMany: vi.fn() },
  projectMember: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  projectTask: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  approvalRequest: { findMany: vi.fn() },
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
import { audit } from "../lib/audit.js";
import { assertCapability } from "../lib/permissions.js";
import { adminProjectsRoutes } from "../routes/admin/projects.js";

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  mockPrisma.project.findFirst.mockResolvedValue(null);
  mockPrisma.project.findMany.mockResolvedValue([]);
  mockPrisma.projectMember.findMany.mockResolvedValue([]);
  mockPrisma.projectMember.findFirst.mockResolvedValue(null);
  mockPrisma.projectTask.findMany.mockResolvedValue([]);
  mockPrisma.projectTask.findFirst.mockResolvedValue(null);
  mockPrisma.approvalRequest.findMany.mockResolvedValue([]);
  vi.mocked(assertCapability).mockResolvedValue(undefined);
  app = Fastify({ logger: false });
  app.decorateRequest("programId", "");
  app.decorateRequest("memberId", null);
  app.decorateRequest("adminId", null);
  app.decorateRequest("apiKeyScope", "");
  app.decorateRequest("actor", { type: "ADMIN_USER", id: "admin-1" });
  app.addHook("preHandler", async (request) => {
    request.programId = "program-1";
    request.adminId = "admin-1";
    request.memberId = "member-1";
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
  it("returns not found for a project outside the current program", async () => {
    mockPrisma.project.findFirst.mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/admin/projects/project-2" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("PROJECT_NOT_FOUND");
    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "project-2", programId: "program-1" },
      }),
    );
  });

  it("redacts project finances from a non-owner without project.finance.view", async () => {
    vi.mocked(assertCapability).mockImplementation(async (_request, capability) => {
      if (capability === "project.finance.view") throw new LoyaltyError("FORBIDDEN", 403);
    });
    mockPrisma.project.findFirst
      .mockResolvedValueOnce({ id: "project-2", createdByAdminId: "admin-2" })
      .mockResolvedValueOnce({
        id: "project-2",
        programId: "program-1",
        createdByAdminId: "admin-2",
        name: "Private budget project",
        fieldValues: { internal_budget_note: "secret financial context" },
        createdBy: { id: "admin-2", name: "Other PM", email: "pm@example.test" },
        members: [],
        tasks: [],
      });

    const response = await app.inject({ method: "GET", url: "/admin/projects/project-2" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      canManage: false,
      canViewBudget: false,
      fieldValues: {},
      budgets: [],
      issueBatches: [],
      budgetTransactions: [],
      approvalSummary: null,
    });
    expect(mockPrisma.project.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      include: expect.objectContaining({ budgets: false, issueBatches: false, budgetTransactions: false }),
    }));
    expect(mockPrisma.approvalRequest.findMany).not.toHaveBeenCalled();
  });

  it("lets the project creator view finances and returns sanitized approval summaries", async () => {
    vi.mocked(assertCapability).mockImplementation(async (_request, capability) => {
      if (capability === "project.finance.view") throw new LoyaltyError("FORBIDDEN", 403);
    });
    const requestedAt = new Date("2026-09-01T00:00:00.000Z");
    mockPrisma.project.findFirst
      .mockResolvedValueOnce({ id: "project-1", createdByAdminId: "admin-1" })
      .mockResolvedValueOnce({
        id: "project-1",
        programId: "program-1",
        createdByAdminId: "admin-1",
        name: "My project",
        createdBy: { id: "admin-1", name: "Current PM", email: "pm@example.test" },
        budgets: [{ id: "budget-1", approvedAmount: 100, pointType: { code: "PTS", name: "Points", unitLabel: "points" } }],
        members: [],
        tasks: [],
        issueBatches: [{ id: "batch-1", status: "PENDING", allocations: [] }],
        budgetTransactions: [{ id: "tx-1", amount: 100 }],
      });
    mockPrisma.approvalRequest.findMany.mockResolvedValue([
      { id: "approval-1", actionKey: "PROJECT_PLAN_APPROVAL", status: "REJECTED", requestedAt, resolvedAt: requestedAt, resolutionComment: "Needs a smaller scope", decisions: [{ decision: "REJECT", comment: "Needs a smaller scope" }] },
      { id: "approval-2", actionKey: "PROJECT_POINT_ISSUANCE", status: "PENDING", requestedAt, resolvedAt: null, resolutionComment: null, decisions: [] },
    ]);

    const response = await app.inject({ method: "GET", url: "/admin/projects/project-1" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      canManage: true,
      canViewBudget: true,
      budgets: [{ id: "budget-1" }],
      issueBatches: [{ id: "batch-1" }],
      budgetTransactions: [{ id: "tx-1" }],
      approvalSummary: {
        plan: { id: "approval-1", status: "REJECTED", decision: "REJECT", comment: "Needs a smaller scope" },
        distribution: { id: "approval-2", status: "PENDING", decision: null, comment: null },
      },
    });
    expect(response.json().data.approvalSummary.plan).not.toHaveProperty("payload");
    const approvalQuery = mockPrisma.approvalRequest.findMany.mock.calls[0]?.[0];
    expect(approvalQuery.where).toEqual(expect.objectContaining({ programId: "program-1" }));
    expect(approvalQuery.select).not.toHaveProperty("payload");
  });

  it("redacts project finances from a non-owner in the admin list", async () => {
    vi.mocked(assertCapability).mockImplementation(async (_request, capability) => {
      if (capability === "project.finance.view") throw new LoyaltyError("FORBIDDEN", 403);
    });
    mockPrisma.project.findMany.mockResolvedValue([{
      id: "project-2",
      createdByAdminId: "admin-2",
      fieldValues: { contract_value: "secret financial context" },
      budgets: [{ id: "secret-budget", approvedAmount: 900 }],
      createdBy: { id: "admin-2", name: "Other PM", email: "pm@example.test" },
      _count: { members: 2, tasks: 3 },
    }]);

    const response = await app.inject({ method: "GET", url: "/admin/projects" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).toMatchObject({ canManage: false, canViewBudget: false, fieldValues: {}, budgets: [] });
    expect(JSON.stringify(response.json())).not.toContain("secret-budget");
    expect(JSON.stringify(response.json())).not.toContain("secret financial context");
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

describe("member project routes", () => {
  it("records member invitation response with before and after status", async () => {
    mockPrisma.projectMember.findFirst.mockResolvedValue({ id: "membership-1", status: "INVITED" });
    mockPrisma.projectMember.update.mockResolvedValue({ id: "membership-1", status: "ACCEPTED" });
    const response = await app.inject({ method: "POST", url: "/members/me/projects/project-1/respond", payload: { response: "ACCEPTED" } });
    expect(response.statusCode).toBe(200);
    expect(audit).toHaveBeenCalledWith("program-1", { type: "MEMBER", id: "member-1" }, "CONFIG_CHANGE", "project", "project-1", expect.objectContaining({ operation: "RESPOND_INVITATION", before: { status: "INVITED" }, after: { status: "ACCEPTED" } }));
  });
  it("returns an explicit safe summary and only accepted members' assigned tasks", async () => {
    const invitedAt = new Date("2026-09-01T00:00:00.000Z");
    const completedAt = new Date("2026-09-20T00:00:00.000Z");
    mockPrisma.projectMember.findMany.mockResolvedValue([
      { id: "membership-1", projectId: "project-1", status: "ACCEPTED", invitedAt, respondedAt: invitedAt, invitedByAdminId: "internal-admin", project: { id: "project-1", name: "Accepted", description: "Visible brief", status: "ACTIVE", activatedAt: invitedAt, completedAt: null, closedAt: null, createdBy: { name: "Project Manager", email: "manager-secret@example.test" }, fieldValues: { internal_note: "secret" } } },
      { id: "membership-2", projectId: "project-2", status: "DECLINED", invitedAt, respondedAt: completedAt, invitedByAdminId: "internal-admin", project: { id: "project-2", name: "Declined", description: null, status: "CLOSED", activatedAt: invitedAt, completedAt, closedAt: completedAt, createdBy: { name: "Other Manager", email: "manager-secret@example.test" }, fieldValues: { internal_note: "secret" } } },
    ]);
    mockPrisma.projectTask.findMany.mockResolvedValue([
      { id: "task-1", projectId: "project-1", title: "My task", description: "Own work", status: "IN_PROGRESS", dueAt: completedAt, assigneeId: "member-1" },
    ]);

    const response = await app.inject({ method: "GET", url: "/members/me/projects" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(2);
    expect(response.json().data[0]).toMatchObject({
      status: "ACCEPTED",
      project: {
        id: "project-1",
        activatedAt: invitedAt.toISOString(),
        projectManager: { name: "Project Manager" },
        tasks: [{ id: "task-1", title: "My task" }],
      },
    });
    expect(response.json().data[1]).toMatchObject({ status: "DECLINED", project: { id: "project-2", tasks: [] } });
    const responseText = JSON.stringify(response.json());
    for (const privateValue of ["internal-admin", "fieldValues", "secret", "manager-secret@example.test", "budget", "approvedAmount", "assigneeId", "projectId"]) {
      expect(responseText).not.toContain(privateValue);
    }
    expect(mockPrisma.projectTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: { in: ["project-1"] }, assigneeId: "member-1" },
    }));
  });

  it("only lets an accepted active member update their own assigned task", async () => {
    mockPrisma.projectMember.findFirst.mockResolvedValue({ id: "membership-1" });
    mockPrisma.projectTask.findFirst.mockResolvedValue({ id: "task-1", projectId: "project-1", assigneeId: "member-1", title: "Prepare report", status: "IN_PROGRESS" });
    mockPrisma.projectTask.update.mockResolvedValue({ id: "task-1", status: "DONE" });

    const response = await app.inject({ method: "PATCH", url: "/members/me/projects/project-1/tasks/task-1", payload: { status: "DONE" } });

    expect(response.statusCode).toBe(200);
    expect(mockPrisma.projectMember.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: "project-1", memberId: "member-1", status: "ACCEPTED", project: { programId: "program-1", status: "ACTIVE" } },
    }));
    expect(mockPrisma.projectTask.findFirst).toHaveBeenCalledWith({ where: { id: "task-1", projectId: "project-1", assigneeId: "member-1" } });
    expect(audit).toHaveBeenCalledWith("program-1", { type: "MEMBER", id: "member-1" }, "CONFIG_CHANGE", "project_task", "task-1", expect.objectContaining({ before: { status: "IN_PROGRESS" }, after: { status: "DONE" }, title: "Prepare report" }));
  });
});
