import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const transaction = vi.hoisted(() => vi.fn());
vi.mock("../db.js", () => ({ prisma: { $transaction: transaction } }));

import { decideApprovalRequest } from "../lib/approval-workflows.js";
import { walletService } from "../lib/wallets.js";
import { pointExchangeApprovalHook } from "../lib/workflow-integrations.js";

function initialState() {
  return {
    approval: {
      id: "approval-1",
      programId: "program-1",
      status: "PENDING",
      actionKey: "POINT_EXCHANGE",
      subjectType: "PointExchangeRequest",
      subjectId: "exchange-1",
      currentStepOrder: 1 as number | null,
      steps: [
        { id: "step-1", stepOrder: 1, status: "PENDING", requiredApprovalCount: 2, assigneesSnapshot: [{ adminId: "reviewer-1" }, { adminId: "reviewer-2" }], decisions: [] as Record<string, unknown>[] },
        { id: "step-2", stepOrder: 2, status: "WAITING", requiredApprovalCount: 2, assigneesSnapshot: [{ adminId: "finance-1" }, { adminId: "finance-2" }], decisions: [] as Record<string, unknown>[] },
      ],
    },
    voucher: {
      id: "exchange-1",
      programId: "program-1",
      memberId: "member-1",
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
      pointType: { id: "type-1", expiryMode: "NEVER" },
      transaction: { metadata: { consumedLots: [{ amount: 40, expiresAt: "2027-01-01T00:00:00.000Z" }, { amount: 60, expiresAt: null }] } },
    },
    wallet: { id: "wallet-1", balance: 400, totalEarned: 500, totalSpent: 100 },
    ledger: [] as Record<string, unknown>[],
    lots: [] as Record<string, unknown>[],
  };
}

type State = ReturnType<typeof initialState>;

function transactionClient(state: State, failCompletion: boolean) {
  return {
    approvalRequest: {
      findFirst: vi.fn().mockImplementation(() => structuredClone(state.approval)),
      update: vi.fn().mockImplementation(({ data }) => Object.assign(state.approval, data)),
    },
    adminUser: { findFirst: vi.fn().mockResolvedValue({ id: "active-admin" }) },
    approvalDecision: {
      create: vi.fn().mockImplementation(({ data }) => {
        state.approval.steps.find((step) => step.id === data.stepId)?.decisions.push(data);
        return { id: `decision-${data.approverAdminId}`, ...data };
      }),
    },
    approvalRequestStep: {
      update: vi.fn().mockImplementation(({ where, data }) => Object.assign(state.approval.steps.find((step) => step.id === where.id)!, data)),
      updateMany: vi.fn().mockImplementation(({ where, data }) => {
        for (const step of state.approval.steps.filter((step) => step.status === where.status)) Object.assign(step, data);
        return { count: 1 };
      }),
    },
    adminApprovalNotificationRead: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    pointExchangeRequest: {
      findFirst: vi.fn().mockImplementation(() => structuredClone(state.voucher)),
      update: vi.fn().mockImplementation(({ data }) => {
        if (data.status === "COMPLETED" && failCompletion) throw new Error("Completion write failed");
        return Object.assign(state.voucher, data);
      }),
    },
    customPointWallet: {
      upsert: vi.fn().mockImplementation(() => structuredClone(state.wallet)),
      update: vi.fn().mockImplementation(({ data }) => {
        state.wallet.balance += data.balance.increment;
        state.wallet.totalEarned += data.totalEarned.increment;
        return structuredClone(state.wallet);
      }),
      updateMany: vi.fn(),
    },
    customPointTransaction: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }) => {
        const created = { id: "refund-1", ...data };
        state.ledger.push(created);
        return created;
      }),
    },
    customPointLot: { create: vi.fn().mockImplementation(({ data }) => state.lots.push(data)) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
}

describe("point exchange final workflow completion", () => {
  let state: State;
  let lastTx: ReturnType<typeof transactionClient>;
  let failCompletion: boolean;

  beforeEach(() => {
    vi.restoreAllMocks();
    transaction.mockReset();
    state = initialState();
    failCompletion = false;
    // Model commit-on-success so a hook error cannot commit an earlier write.
    transaction.mockImplementation(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const draft = structuredClone(state);
      lastTx = transactionClient(draft, failCompletion);
      const result = await callback(lastTx as unknown as Prisma.TransactionClient);
      state = draft;
      return result;
    });
  });

  const approve = (actorId: string, comment?: string) =>
    decideApprovalRequest("program-1", "approval-1", actorId, "APPROVE", comment, pointExchangeApprovalHook);

  it("waits for all layers and the final quorum, then completes without another ledger debit", async () => {
    const transition = vi.spyOn(walletService, "updateExchangeRequestWithTransaction");
    for (const actor of ["reviewer-1", "reviewer-2", "finance-1"]) {
      expect((await approve(actor)).status).toBe("PENDING");
      expect(state.voucher.status).toBe("PENDING");
      expect(transition).not.toHaveBeenCalled();
    }
    expect(state.approval.currentStepOrder).toBe(2);

    expect((await approve("finance-2", "Finance checked")).status).toBe("APPROVED");

    expect(transition.mock.calls.map((call) => call[3])).toEqual(["APPROVED", "COMPLETED"]);
    expect(transition.mock.calls.every((call) => call[0] === lastTx)).toBe(true);
    expect(state.voucher).toMatchObject({
      status: "COMPLETED",
      approvedBy: "finance-2",
      approvalNote: "Finance checked",
      completedBy: "finance-2",
      completionReference: "approval:approval-1",
      completionNote: "Automatically completed after final workflow approval. Finance checked",
      approvedAt: expect.any(Date),
      completedAt: expect.any(Date),
    });
    expect(state.wallet).toMatchObject({ balance: 400, totalSpent: 100 });
    expect(lastTx.customPointWallet.update).not.toHaveBeenCalled();
    expect(lastTx.customPointWallet.updateMany).not.toHaveBeenCalled();
    expect(lastTx.customPointTransaction.create).not.toHaveBeenCalled();

    await expect(approve("finance-2")).rejects.toMatchObject({ code: "APPROVAL_REQUEST_NOT_PENDING" });
    expect(transition).toHaveBeenCalledTimes(2);
  });

  it("rejects in an intermediate layer and refunds the original lots exactly once", async () => {
    await approve("reviewer-1");
    const result = await decideApprovalRequest("program-1", "approval-1", "reviewer-2", "REJECT", "Incorrect voucher", pointExchangeApprovalHook);

    expect(result.status).toBe("REJECTED");
    expect(state.voucher).toMatchObject({ status: "REJECTED", cancelledBy: "reviewer-2", cancellationReason: "Incorrect voucher", completedAt: null });
    expect(state.wallet.balance).toBe(500);
    expect(state.ledger).toEqual([expect.objectContaining({
      action: "REVERSAL", amount: 100, actorId: "reviewer-2", idempotencyKey: "exchange-refund:exchange-1",
    })]);
    expect(state.lots).toEqual([
      expect.objectContaining({ remainingAmount: 40, expiresAt: new Date("2027-01-01T00:00:00.000Z") }),
      expect.objectContaining({ remainingAmount: 60, expiresAt: null }),
    ]);
    expect(state.approval.steps[1]?.status).toBe("SKIPPED");
    await expect(decideApprovalRequest("program-1", "approval-1", "reviewer-2", "REJECT", "Retry", pointExchangeApprovalHook)).rejects.toMatchObject({ code: "APPROVAL_REQUEST_NOT_PENDING" });
    expect(state.ledger).toHaveLength(1);
  });

  it("propagates completion failure and leaves the approval, voucher, and final decision uncommitted", async () => {
    for (const actor of ["reviewer-1", "reviewer-2", "finance-1"]) await approve(actor);
    failCompletion = true;

    await expect(approve("finance-2")).rejects.toThrow("Completion write failed");

    expect(lastTx.pointExchangeRequest.update.mock.calls.map(([input]) => input.data.status)).toEqual(["APPROVED", "COMPLETED"]);
    expect(state.approval).toMatchObject({ status: "PENDING", currentStepOrder: 2 });
    expect(state.approval.steps[1]?.decisions).toHaveLength(1);
    expect(state.voucher).toMatchObject({ status: "PENDING", approvedAt: null, completedAt: null });
    expect(state.wallet.balance).toBe(400);
    expect(transaction.mock.calls.at(-1)?.[1]).toEqual({ isolationLevel: "Serializable" });

    failCompletion = false;
    await approve("finance-2");
    expect(state.approval.status).toBe("APPROVED");
    expect(state.voucher.status).toBe("COMPLETED");
  });
});
