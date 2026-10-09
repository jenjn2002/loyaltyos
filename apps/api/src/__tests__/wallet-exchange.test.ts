import { beforeEach, describe, expect, it, vi } from "vitest";

import { WalletService } from "../lib/wallets.js";

const baseRequest = {
  id: "exchange-1",
  programId: "program-1",
  memberId: "member-1",
  pointTypeId: "type-1",
  documentNumber: "EXC-20260909-ABC123",
  status: "PENDING",
  amount: 100,
  exchangeRateId: "rate-1",
  approvedAt: null,
  approvedBy: null,
  approvalNote: null,
  completedAt: null,
  completedBy: null,
  completionReference: null,
  completionNote: null,
  cancelledAt: null,
  cancelledBy: null,
  cancellationReason: null,
  pointType: {},
  transaction: null,
};

describe("WalletService accounting exchange workflow", () => {
  const findFirst = vi.fn();
  const update = vi.fn();
  const tx = { pointExchangeRequest: { findFirst, update } };
  const db = { $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)) };
  const service = new WalletService(db as never);

  beforeEach(() => {
    vi.clearAllMocks();
    update.mockImplementation(({ data }: { data: unknown }) => ({ ...baseRequest, ...data }));
  });

  it("approves a pending voucher with actor and note", async () => {
    findFirst.mockResolvedValue(baseRequest);

    const result = await service.updateExchangeRequest(
      "program-1",
      "exchange-1",
      "APPROVED",
      { type: "ADMIN_USER", id: "approver-1" },
      { note: "Checked by accounting" },
    );

    expect(result).toMatchObject({
      status: "APPROVED",
      approvedBy: "approver-1",
      approvalNote: "Checked by accounting",
    });
  });

  it("requires an accounting reference to complete an approved voucher", async () => {
    findFirst.mockResolvedValue({ ...baseRequest, status: "APPROVED" });

    await expect(
      service.updateExchangeRequest("program-1", "exchange-1", "COMPLETED", {
        type: "ADMIN_USER",
        id: "accountant-1",
      }),
    ).rejects.toMatchObject({ code: "POINT_EXCHANGE_COMPLETION_REFERENCE_REQUIRED" });
    expect(update).not.toHaveBeenCalled();
  });

  it("completes an approved voucher and stores its reference", async () => {
    findFirst.mockResolvedValue({ ...baseRequest, status: "APPROVED" });

    const result = await service.updateExchangeRequest(
      "program-1",
      "exchange-1",
      "COMPLETED",
      { type: "ADMIN_USER", id: "accountant-1" },
      { reference: "PAYROLL-2026-09-001", note: "Included in September payroll" },
    );

    expect(result).toMatchObject({
      status: "COMPLETED",
      completedBy: "accountant-1",
      completionReference: "PAYROLL-2026-09-001",
      completionNote: "Included in September payroll",
    });
  });

  it("rejects skipping approval", async () => {
    findFirst.mockResolvedValue(baseRequest);

    await expect(
      service.updateExchangeRequest(
        "program-1",
        "exchange-1",
        "COMPLETED",
        { type: "ADMIN_USER", id: "accountant-1" },
        { reference: "PAYROLL-1" },
      ),
    ).rejects.toMatchObject({ code: "POINT_EXCHANGE_STATUS_INVALID" });
  });
});

describe("WalletService exchange limits", () => {
  it("counts requests for the selected payout type across rate versions", async () => {
    const aggregate = vi.fn().mockImplementation(({ where }: { where: { payoutType: string } }) => {
      expect(where).toMatchObject({
        memberId: "member-1",
        pointTypeId: "type-1",
        payoutType: "CASH",
        status: { notIn: ["CANCELLED", "REJECTED"] },
      });
      return { _sum: { amount: 60 } };
    });
    const tx = {
      pointExchangeRequest: {
        findUnique: vi.fn().mockResolvedValue(null),
        aggregate,
      },
      pointTypeDefinition: {
        findFirst: vi.fn().mockResolvedValue({
          id: "type-1",
          exchangeable: true,
          cashEligible: true,
        }),
      },
      pointExchangeRate: {
        findFirst: vi.fn().mockResolvedValue({
          id: "rate-2",
          minPoints: 1,
          maxPoints: null,
          periodLimitPoints: 150,
          periodDays: 30,
        }),
      },
    };
    const db = { $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)) };

    await expect(
      new WalletService(db as never).exchange("member-1", "program-1", {
        pointTypeId: "type-1",
        amount: 100,
        payoutType: "CASH",
        idempotencyKey: "cash-request-1",
      }),
    ).rejects.toMatchObject({ code: "POINT_EXCHANGE_PERIOD_LIMIT" });
    expect(aggregate).toHaveBeenCalledOnce();
    expect(aggregate.mock.calls[0]?.[0].where).not.toHaveProperty("exchangeRateId");
  });
});

describe("WalletService exchange approval history", () => {
  const approvalSummary = {
    id: "approval-1", status: "APPROVED", currentStepOrder: null,
    resolvedAt: new Date("2026-10-06T10:00:00Z"), resolutionComment: "Final approval",
  };
  const approver = { id: "admin-1", name: "Finance approver", email: "finance@example.com" };
  const voucher = {
    ...baseRequest, status: "COMPLETED", approvedBy: "admin-1", completedBy: "admin-1",
    approvalRequest: approvalSummary,
  };

  function database() {
    return {
      pointExchangeRequest: {
        findMany: vi.fn().mockResolvedValue([voucher]), count: vi.fn().mockResolvedValue(1),
      },
      adminUser: { findMany: vi.fn().mockResolvedValue([approver]) },
      approvalRequest: { findMany: vi.fn().mockResolvedValue([{
        id: "approval-1", requestedAt: new Date("2026-10-06T09:00:00Z"),
        workflowSnapshot: { name: "Original exchange workflow", privateConfiguration: "not exposed" },
        workflow: { name: "Renamed exchange workflow" },
        steps: [{
          id: "step-1", stepOrder: 1, name: "Finance", status: "APPROVED",
          approvalMode: "ANY", requiredApprovalCount: 1,
          assigneesSnapshot: [{ adminId: "admin-1", name: approver.name, email: approver.email, role: "Owner" }, null, "invalid"],
          decisions: [{ id: "decision-1", decision: "APPROVE", comment: "Checked budget", createdAt: approvalSummary.resolvedAt, approver: { ...approver, role: "Owner" } }],
        }],
      }]) },
    };
  }

  it("includes workflow layers, decisions and actor names for admin callers only", async () => {
    const db = database();
    const result = await new WalletService(db as never).exchangeRequests("program-1", { includeApprovalDetails: true });

    expect(result.items[0]).toMatchObject({
      approvedByAdmin: approver, completedByAdmin: approver,
      approvalRequest: {
        ...approvalSummary, workflowName: "Original exchange workflow",
        steps: [{ name: "Finance", assigneesSnapshot: [{ adminId: "admin-1" }], decisions: [{ comment: "Checked budget", approver }] }],
      },
    });
    expect(result.items[0]?.approvalRequest).not.toHaveProperty("workflowSnapshot");
    expect(db.approvalRequest.findMany.mock.calls[0]?.[0].where).toEqual({ programId: "program-1", id: { in: ["approval-1"] } });
    expect(db.adminUser.findMany.mock.calls[0]?.[0].where).toEqual({ programId: "program-1", id: { in: ["admin-1"] } });
  });

  it("does not fetch or expose internal workflow history on member requests", async () => {
    const db = database();
    const result = await new WalletService(db as never).exchangeRequests("program-1", { memberId: "member-1" });

    expect(result.items[0]?.approvalRequest).toEqual(approvalSummary);
    expect(result.items[0]).not.toHaveProperty("approvedByAdmin");
    expect(result.items[0]?.approvalRequest).not.toHaveProperty("steps");
    expect(db.approvalRequest.findMany).not.toHaveBeenCalled();
    expect(db.adminUser.findMany).not.toHaveBeenCalled();
  });
});
