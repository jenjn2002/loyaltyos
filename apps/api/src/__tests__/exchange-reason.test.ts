import { describe, expect, it, vi } from "vitest";

import { formatPointExchangeReason, ledgerReasonForDisplay } from "../lib/exchange-reason.js";
import { WalletService } from "../lib/wallets.js";

describe("exchange ledger reasons", () => {
  const voucher = { documentNumber: "EXC-20261007-001", payoutType: "CASH" };

  it("describes the voucher and payout type", () => {
    expect(formatPointExchangeReason(voucher)).toBe("Point exchange: EXC-20261007-001 · Cash");
    expect(formatPointExchangeReason({ ...voucher, payoutType: "NON_CASH" }, "vi-VN"))
      .toBe("Đổi điểm: EXC-20261007-001 · Phi tiền mặt");
  });

  it("fills blank historical reasons for display without changing their hashed data", () => {
    const transaction = Object.freeze({ action: "EXCHANGE", reason: null, exchangeRequest: voucher, recordHash: "original-hash" });
    expect(ledgerReasonForDisplay(transaction, "vi-VN")).toBe("Đổi điểm: EXC-20261007-001 · Tiền mặt");
    expect(transaction.reason).toBeNull();
    expect(transaction.recordHash).toBe("original-hash");
  });

  it("uses saved metadata when a voucher is unavailable", () => {
    expect(ledgerReasonForDisplay({ action: "EXCHANGE", reason: "  ", metadata: voucher }, "en-US"))
      .toBe("Point exchange: EXC-20261007-001 · Cash");
    expect(ledgerReasonForDisplay({ action: "EXCHANGE", reason: null, metadata: { payoutType: "NON_CASH" } }, "vi-VN"))
      .toBe("Đổi điểm · Phi tiền mặt");
  });

  it("keeps manual reasons and non-exchange reasons unchanged", () => {
    expect(ledgerReasonForDisplay({ action: "EXCHANGE", reason: "Payroll correction", exchangeRequest: voucher }, "vi-VN")).toBe("Payroll correction");
    expect(ledgerReasonForDisplay({ action: "ADJUSTMENT", reason: null })).toBeNull();
  });

  it("localizes generated reasons and handles missing or malformed metadata", () => {
    expect(ledgerReasonForDisplay({ action: "EXCHANGE", reason: formatPointExchangeReason(voucher), exchangeRequest: voucher }, "vi-VN"))
      .toBe("Đổi điểm: EXC-20261007-001 · Tiền mặt");
    expect(ledgerReasonForDisplay({ action: "EXCHANGE", reason: null, metadata: ["invalid"] })).toBe("Point exchange");
  });

  it("persists the reason and document context before hashing a new exchange debit", async () => {
    const createTransaction = vi.fn().mockImplementation(({ data }) => ({ id: "transaction-1", ...data }));
    const tx = {
      pointExchangeRequest: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => ({ id: "exchange-1", ...data })),
      },
      pointTypeDefinition: { findFirst: vi.fn().mockResolvedValue({ id: "type-1", exchangeable: true, cashEligible: true, allowNegativeBalance: false }) },
      pointExchangeRate: { findFirst: vi.fn().mockResolvedValue({ id: "rate-1", minPoints: 1, maxPoints: null, periodLimitPoints: null, valueMinorPerPoint: 100, currency: "VND", payoutMechanism: "Payroll" }) },
      customPointWallet: {
        upsert: vi.fn().mockResolvedValue({ id: "wallet-1", balance: 1000 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "wallet-1", balance: 900 }),
      },
      customPointLot: { findMany: vi.fn().mockResolvedValue([]) },
      customPointTransaction: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null), create: createTransaction },
      approvalWorkflow: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const db = { $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)) };
    const result = await new WalletService(db as never).exchange("member-1", "program-1", {
      pointTypeId: "type-1", amount: 100, payoutType: "CASH", idempotencyKey: "exchange-test",
    });

    expect(createTransaction.mock.calls[0]?.[0].data).toMatchObject({
      action: "EXCHANGE", amount: -100, reason: formatPointExchangeReason(result.request),
      metadata: { documentNumber: result.request.documentNumber, payoutType: "CASH" },
      hashVersion: 2, recordHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("loads voucher context for history without rewriting stored reasons", async () => {
    const row = { id: "transaction-1", action: "EXCHANGE", reason: null, recordHash: "original-hash", source: "member:exchange", exchangeRequest: voucher };
    const findMany = vi.fn().mockResolvedValue([row]);
    const db = { customPointTransaction: { findMany, count: vi.fn().mockResolvedValue(1) } };
    const result = await new WalletService(db as never).history("program-1", {});

    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { programId: "program-1" }, include: { exchangeRequest: { select: { documentNumber: true, payoutType: true } } } });
    expect(result.items[0]).toMatchObject({ reason: null, recordHash: "original-hash", exchangeRequest: voucher });
  });
});
