import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    program: { findMany: vi.fn() },
    member: { findMany: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
  sendTrigger: vi.fn(),
  createWorker: vi.fn(),
  wallet: {
    expire: vi.fn(),
    expiringNotices: vi.fn(),
    markExpiryNoticeSent: vi.fn(),
    clearMemberWithTransaction: vi.fn(),
  },
}));

vi.mock("../db.js", () => ({ prisma: mocks.prisma }));
vi.mock("../lib/audit.js", () => ({ audit: mocks.audit }));
vi.mock("../lib/notifications-setup.js", () => ({ notificationsService: { sendTrigger: mocks.sendTrigger } }));
vi.mock("../lib/queue.js", () => ({ createWorker: mocks.createWorker }));
vi.mock("../lib/wallets.js", () => ({ walletService: mocks.wallet }));

import { startCreditExpiryWorker } from "../workers/credits.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.program.findMany.mockResolvedValue([{ id: "program-1", defaultLocale: "vi-VN" }]);
  mocks.prisma.member.findMany.mockResolvedValue([]);
  mocks.prisma.member.findFirst.mockResolvedValue(null);
  mocks.wallet.expire.mockResolvedValue(undefined);
  mocks.wallet.expiringNotices.mockResolvedValue([
    {
      memberId: "member-1",
      amount: 10,
      pointType: { name: "P-credit" },
      expiresAt: new Date("2026-10-10T00:00:00.000Z"),
      days: 5,
      lotId: "lot-1",
      member: { email: "member@example.test", locale: null },
    },
  ]);
  mocks.sendTrigger.mockResolvedValue([]);
  mocks.wallet.markExpiryNoticeSent.mockResolvedValue(undefined);
});

describe("credit expiry worker notifications", () => {
  it("uses the program default locale when the member has no explicit locale", async () => {
    startCreditExpiryWorker();
    const worker = mocks.createWorker.mock.calls[0]?.[1] as (() => Promise<void>) | undefined;
    expect(worker).toBeTypeOf("function");
    await worker?.();

    expect(mocks.sendTrigger).toHaveBeenCalledWith(
      "program-1",
      "credit.expiring",
      "member-1",
      expect.objectContaining({ _locale: "vi-VN" }),
    );
  });
});
