import { beforeEach, describe, expect, it, vi } from "vitest";

import { WalletService } from "../lib/wallets.js";

const pointType = {
  id: "point-type-1",
  programId: "program-1",
  isActive: true,
  archivedAt: null,
  bankEnabled: true,
  allowManualAdjustment: true,
  allowNegativeBalance: false,
};

describe("WalletService bank cycle returns", () => {
  const tx = {
    pointTypeDefinition: { findFirst: vi.fn() },
    member: { findFirst: vi.fn() },
    pointBankTransaction: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    pointBank: { upsert: vi.fn(), update: vi.fn() },
    pointBankCycle: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    customPointTransaction: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    customPointWallet: { upsert: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    customPointLot: { findMany: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
  };
  const service = new WalletService({} as never);

  beforeEach(() => {
    vi.clearAllMocks();
    tx.pointTypeDefinition.findFirst.mockResolvedValue(pointType);
    tx.member.findFirst.mockResolvedValue({ id: "member-1", status: "ACTIVE", deletedAt: null });
    tx.pointBankTransaction.findUnique.mockResolvedValue(null);
    tx.pointBankTransaction.create.mockImplementation(({ data }) => data);
    tx.pointBankTransaction.findFirst.mockResolvedValue(null);
    tx.pointBank.upsert.mockResolvedValue({ id: "bank-1" });
    tx.pointBank.update.mockResolvedValue({ balance: 500 });
    tx.pointBankCycle.findFirst.mockResolvedValue({ id: "cycle-1" });
    tx.pointBankCycle.updateMany.mockResolvedValue({ count: 1 });
    tx.pointBankCycle.update.mockResolvedValue({});
    tx.customPointTransaction.findUnique.mockResolvedValue(null);
    tx.customPointTransaction.findFirst.mockResolvedValue(null);
    tx.customPointTransaction.create.mockImplementation(({ data }) => ({
      id: "ledger-1",
      ...data,
    }));
    tx.customPointWallet.upsert.mockResolvedValue({ id: "wallet-1", balance: 500 });
    tx.customPointWallet.updateMany.mockResolvedValue({ count: 1 });
    tx.customPointWallet.findUniqueOrThrow.mockResolvedValue({ balance: 400 });
    tx.customPointLot.findMany.mockResolvedValue([]);
    tx.$queryRaw.mockResolvedValue([]);
  });

  it("subtracts a bank return from the active cycle's allocated total", async () => {
    await service.adjustWithTransaction(
      tx as never,
      "program-1",
      "member-1",
      { pointTypeId: pointType.id },
      -100,
      "Return unused points",
      { type: "ADMIN_USER", id: "admin-1" },
      "adjustment-return-1",
    );

    expect(tx.pointBankCycle.updateMany).toHaveBeenCalledWith({
      where: { id: "cycle-1", allocated: { gte: 100 } },
      data: { allocated: { decrement: 100 } },
    });
  });

  it("does not allow a return to make the cycle allocation negative", async () => {
    tx.pointBankCycle.updateMany.mockResolvedValue({ count: 0 });

    await service.adjustWithTransaction(
      tx as never,
      "program-1",
      "member-1",
      { pointTypeId: pointType.id },
      -600,
      "Return points",
      { type: "ADMIN_USER", id: "admin-1" },
      "adjustment-return-2",
    );

    expect(tx.pointBankCycle.update).toHaveBeenCalledWith({
      where: { id: "cycle-1" },
      data: { allocated: 0 },
    });
  });
});
