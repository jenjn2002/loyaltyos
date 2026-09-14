import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  createApprovalRequestWithClient,
  decideApprovalRequestWithClient,
  selectMatchingWorkflow,
  validateWorkflowDefinition,
  workflowMatchesScope,
  workflowScopesMayOverlap,
} from "../lib/approval-workflows.js";

describe("approval workflow definition", () => {
  it("allows COUNT larger than assignment rows because a role expands to multiple users", () => {
    expect(() =>
      validateWorkflowDefinition({
        actionKey: "POINT_EXCHANGE",
        name: "Cash voucher approval",
        selfApprovalPolicy: "DENY",
        steps: [
          {
            name: "Finance review",
            approvalMode: "COUNT",
            requiredApprovalCount: 2,
            assignees: [{ role: "OPERATOR" }],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects duplicate role assignments within a layer", () => {
    expect(() =>
      validateWorkflowDefinition({
        actionKey: "LEAVE_REQUEST",
        name: "Leave approval",
        selfApprovalPolicy: "DENY",
        steps: [
          {
            name: "Manager",
            approvalMode: "ANY",
            requiredApprovalCount: 1,
            assignees: [{ role: "OPERATOR" }, { role: "OPERATOR" }],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects malformed custom action keys and empty layers", () => {
    expect(() =>
      validateWorkflowDefinition({
        actionKey: "bad action",
        name: "Invalid",
        selfApprovalPolicy: "DENY",
        steps: [],
      }),
    ).toThrow();
  });

  it("matches point exchange scopes and selects the highest priority workflow", () => {
    const workflows = [
      { id: "broad", priority: 10, scope: {} },
      { id: "specific", priority: 20, scope: { pointTypeIds: ["pt-1"], minAmount: 100 } },
    ];
    expect(selectMatchingWorkflow(workflows, "POINT_EXCHANGE", { pointTypeId: "pt-1", amount: 150 })).toEqual(
      workflows[1],
    );
    expect(selectMatchingWorkflow(workflows, "POINT_EXCHANGE", { pointTypeId: "pt-2", amount: 150 })).toEqual(
      workflows[0],
    );
    expect(workflowMatchesScope("POINT_EXCHANGE", workflows[1].scope, { pointTypeId: "pt-1", amount: 99 })).toBe(false);
  });

  it("matches reward IDs/categories, rejects equal-priority ambiguity, and allows disjoint scopes", () => {
    expect(workflowMatchesScope("REWARD_REDEMPTION", { rewardIds: ["reward-1"] }, { rewardId: "reward-1" })).toBe(true);
    expect(workflowMatchesScope("REWARD_REDEMPTION", { rewardCategories: ["PHYSICAL_PRODUCT"] }, { rewardCategory: "GIFT_CARD" })).toBe(false);
    expect(() =>
      selectMatchingWorkflow(
        [
          { id: "one", priority: 5, scope: { rewardCategories: ["GIFT_CARD"] } },
          { id: "two", priority: 5, scope: { rewardCategories: ["GIFT_CARD"] } },
        ],
        "REWARD_REDEMPTION",
        { rewardCategory: "GIFT_CARD" },
      ),
    ).toThrow("WORKFLOW_SCOPE_CONFLICT");
    expect(workflowScopesMayOverlap("POINT_EXCHANGE", { pointTypeIds: ["pt-1"] }, { pointTypeIds: ["pt-2"] })).toBe(false);
  });

  it("creates a two-layer request with role/user assignees and immutable scope snapshots", async () => {
    const createdSteps: Record<string, unknown>[] = [];
    const createdRequests: Record<string, unknown>[] = [];
    const workflow = {
      id: "workflow-1",
      programId: "program-1",
      actionKey: "POINT_EXCHANGE",
      name: "Large exchanges",
      description: "Finance approval",
      priority: 20,
      scope: { pointTypeIds: ["pt-1"], minAmount: 100 },
      selfApprovalPolicy: "DENY",
      isActive: true,
      steps: [
        {
          id: "workflow-step-1",
          stepOrder: 1,
          name: "Operator",
          approvalMode: "ANY",
          requiredApprovalCount: 1,
          assignees: [{ adminUserId: "admin-1", role: null }],
        },
        {
          id: "workflow-step-2",
          stepOrder: 2,
          name: "Finance",
          approvalMode: "ALL",
          requiredApprovalCount: 1,
          assignees: [{ adminUserId: null, role: "ANALYST" }],
        },
      ],
    };
    const detail = {
      id: "approval-1",
      programId: "program-1",
      workflow,
      steps: createdSteps,
    };
    const tx = {
      approvalWorkflow: { findMany: vi.fn().mockResolvedValue([workflow]) },
      adminUser: {
        findMany: vi.fn().mockImplementation((query: { where: { id?: { in: string[] } } }) =>
          Promise.resolve(query.where.id?.in.includes("admin-1") ? [{ id: "admin-1", email: "one@example.com", name: "One", role: "OPERATOR" }] : [{ id: "admin-2", email: "two@example.com", name: "Two", role: "ANALYST" }]),
        ),
      },
      approvalRequest: {
        findFirst: vi.fn().mockImplementation((query: { where: { id?: string } }) =>
          Promise.resolve(query.where.id ? detail : null),
        ),
        create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          createdRequests.push(data);
          return Promise.resolve({ id: "approval-1" });
        }),
      },
      approvalRequestStep: {
        create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          createdSteps.push(data);
          return Promise.resolve(data);
        }),
      },
    } as unknown as Prisma.TransactionClient;

    await createApprovalRequestWithClient(tx, {
      programId: "program-1",
      actionKey: "POINT_EXCHANGE",
      requestedByType: "MEMBER",
      requestedById: "member-1",
      subjectType: "PointExchangeRequest",
      subjectId: "exchange-1",
      scopeContext: { pointTypeId: "pt-1", amount: 150, valueMinor: 15000 },
      idempotencyKey: "point-exchange:exchange-1",
    });

    expect(createdSteps.map((step) => step.status)).toEqual(["PENDING", "WAITING"]);
    expect(createdSteps[1]?.requiredApprovalCount).toBe(1);
    expect(createdRequests[0]?.scopeSnapshot).toEqual({
      configured: workflow.scope,
      context: { pointTypeId: "pt-1", amount: 150, valueMinor: 15000 },
    });
    expect((createdRequests[0]?.workflowSnapshot as { priority: number }).priority).toBe(20);
  });

  it("advances layers, rejects duplicates, and fails closed for out-of-order/cross-program decisions", async () => {
    const state = {
      id: "approval-1",
      programId: "program-1",
      status: "PENDING",
      actionKey: "CUSTOM",
      subjectType: "Custom",
      subjectId: "subject-1",
      currentStepOrder: 1,
      workflow: { id: "workflow-1", actionKey: "CUSTOM", name: "Custom", isActive: true },
      steps: [
        { id: "step-1", stepOrder: 1, status: "PENDING", requiredApprovalCount: 2, assigneesSnapshot: [{ adminId: "admin-1" }, { adminId: "admin-3" }], decisions: [] as Record<string, unknown>[] },
        { id: "step-2", stepOrder: 2, status: "WAITING", requiredApprovalCount: 1, assigneesSnapshot: [{ adminId: "admin-2" }], decisions: [] as Record<string, unknown>[] },
      ],
    };
    const tx = {
      approvalRequest: {
        findFirst: vi.fn().mockImplementation((query: { where: { programId: string } }) =>
          Promise.resolve(query.where.programId === "program-1" ? state : null),
        ),
        update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          Object.assign(state, data);
          return Promise.resolve(state);
        }),
      },
      adminUser: { findFirst: vi.fn().mockResolvedValue({ id: "active" }) },
      approvalDecision: {
        create: vi.fn().mockResolvedValue({ id: "decision-1" }),
      },
      approvalRequestStep: {
        update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const step = state.steps.find((candidate) => candidate.id === where.id);
          if (step) Object.assign(step, data);
          return Promise.resolve(step);
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as Prisma.TransactionClient;

    await decideApprovalRequestWithClient(tx, "program-1", "approval-1", "admin-1", "APPROVE", undefined);
    expect(state.currentStepOrder).toBe(1);
    state.steps[0]?.decisions.push({ approverAdminId: "admin-1", decision: "APPROVE" });
    await expect(decideApprovalRequestWithClient(tx, "program-1", "approval-1", "admin-1", "APPROVE", undefined)).rejects.toThrow("APPROVAL_DUPLICATE_DECISION");
    await decideApprovalRequestWithClient(tx, "program-1", "approval-1", "admin-3", "APPROVE", undefined);
    expect(state.currentStepOrder).toBe(2);
    await decideApprovalRequestWithClient(tx, "program-1", "approval-1", "admin-2", "APPROVE", undefined);
    expect(state.status).toBe("APPROVED");
    state.status = "PENDING";
    state.currentStepOrder = 99;
    await expect(decideApprovalRequestWithClient(tx, "program-1", "approval-1", "admin-2", "APPROVE", undefined)).rejects.toThrow("APPROVAL_STEP_OUT_OF_ORDER");
    await expect(decideApprovalRequestWithClient(tx, "program-2", "approval-1", "admin-2", "APPROVE", undefined)).rejects.toThrow("APPROVAL_REQUEST_NOT_FOUND");
  });
});
