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
