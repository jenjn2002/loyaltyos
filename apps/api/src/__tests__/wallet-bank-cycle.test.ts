import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../lib/audit.js", () => ({ audit: vi.fn() }));

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
    pointBank: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
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
    tx.pointBank.findUnique.mockResolvedValue(null);
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

describe("WalletService bank funding", () => {
  const tx = {
    pointTypeDefinition: { findFirst: vi.fn() },
    pointBankTransaction: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    pointBank: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    pointBankCycle: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
  };
  const service = new WalletService({ $transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } as never);
  const fund = () => service.issueBank("program-1", { pointTypeId: pointType.id }, 100, "Funding", { type: "ADMIN_USER", id: "admin-1" }, "fund-1");

  beforeEach(() => {
    vi.clearAllMocks();
    tx.pointTypeDefinition.findFirst.mockResolvedValue(pointType);
    tx.pointBankTransaction.findUnique.mockResolvedValue(null);
    tx.pointBankTransaction.findFirst.mockResolvedValue(null);
    tx.pointBankTransaction.create.mockImplementation(({ data }) => data);
    tx.pointBank.upsert.mockResolvedValue({ id: "bank-1" });
    tx.pointBank.findUnique.mockResolvedValue(null);
    tx.pointBank.update.mockResolvedValue({ balance: 100 });
    tx.pointBankCycle.findFirst.mockResolvedValue(null);
    tx.$queryRaw.mockResolvedValue([]);
  });

  it("rejects funding without an open, unexpired cycle", async () => {
    await expect(fund()).rejects.toMatchObject({ code: "POINT_BANK_CYCLE_REQUIRED" });
    expect(tx.pointBankCycle.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "OPEN", endsAt: { gt: expect.any(Date) } }) }));
    expect(tx.pointBank.update).not.toHaveBeenCalled();
    expect(tx.pointBankTransaction.create).not.toHaveBeenCalled();
  });

  it("funds a cycle scheduled to start later and attaches its id", async () => {
    tx.pointBankCycle.findFirst.mockResolvedValue({ id: "future-cycle" });
    const transaction = await fund();
    expect(transaction).toMatchObject({ cycleId: "future-cycle", amount: 100, type: "ISSUANCE" });
    const where = tx.pointBankCycle.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: "OPEN", endsAt: { gt: expect.any(Date) } });
    expect(where).not.toHaveProperty("startsAt");
    expect(tx.pointBankTransaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ cycleId: "future-cycle" }) }));
  });
});
