import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findNextCycle, closeExpiredBankCycles } = vi.hoisted(() => ({
  findNextCycle: vi.fn(),
  closeExpiredBankCycles: vi.fn(),
}));

vi.mock("../db.js", () => ({ prisma: { pointBankCycle: { findFirst: findNextCycle } } }));
vi.mock("../lib/wallets.js", () => ({ closeExpiredBankCycles }));

import { scheduleBankCycleExpiry, stopBankCycleExpiryScheduler } from "../lib/bank-cycle-scheduler.js";

describe("bank cycle expiry scheduler", () => {
  const now = new Date("2026-11-02T10:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    findNextCycle.mockResolvedValueOnce({ endsAt: new Date(now.getTime() + 5_000) }).mockResolvedValue(null);
    closeExpiredBankCycles.mockResolvedValue(undefined);
  });

  afterEach(() => {
    stopBankCycleExpiryScheduler();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("runs at the configured end time and refreshes the next cycle deadline", async () => {
    scheduleBankCycleExpiry();
    await vi.advanceTimersByTimeAsync(0);

    expect(closeExpiredBankCycles).toHaveBeenCalledTimes(1);
    expect(findNextCycle).toHaveBeenCalledWith({
      where: { status: "OPEN", clearBankOnClose: true },
      orderBy: { endsAt: "asc" },
      select: { endsAt: true },
    });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(closeExpiredBankCycles).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(closeExpiredBankCycles).toHaveBeenCalledTimes(2);
  });

  it("re-arms when a cycle's schedule changes", async () => {
    scheduleBankCycleExpiry();
    await vi.advanceTimersByTimeAsync(0);
    scheduleBankCycleExpiry();
    await vi.advanceTimersByTimeAsync(0);

    expect(closeExpiredBankCycles).toHaveBeenCalledTimes(2);
    expect(findNextCycle).toHaveBeenCalledTimes(2);
  });
});
