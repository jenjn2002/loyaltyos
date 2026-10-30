import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { prisma, memberWallets } = vi.hoisted(() => ({ prisma: { customPointTransaction: { groupBy: vi.fn(), findMany: vi.fn() }, $queryRaw: vi.fn() }, memberWallets: vi.fn() }));
vi.mock("../db.js", () => ({ prisma }));
vi.mock("../lib/approval-workflows.js", () => ({ decideApprovalRequest: vi.fn(), ensurePointExchangeApprovalRequest: vi.fn() }));
vi.mock("../lib/audit.js", () => ({ audit: vi.fn() }));
vi.mock("../lib/created-by.js", () => ({ createdByForEntities: vi.fn() }));
vi.mock("../lib/notifications-setup.js", () => ({ notificationsService: {} }));
vi.mock("../lib/permissions.js", () => ({ requireCapability: () => async () => {}, assertCapability: vi.fn() }));
vi.mock("../lib/wallets.js", () => ({ BANK_CYCLE_RETURN_TYPES: [], walletService: { memberWallets } }));
vi.mock("../lib/workflow-integrations.js", () => ({ pointExchangeApprovalHook: vi.fn() }));
vi.mock("../lib/member-notifications.js", () => ({ notifyCreditExchangeDecision: vi.fn(), notifyCreditAdjustment: vi.fn() }));
import { creditsRoutes } from "../routes/credits.js";
async function appForTest() {
  const app = Fastify(); app.decorateRequest("programId", "program-1"); app.decorateRequest("memberId", "member-1");
  await app.register(creditsRoutes); return app;
}
const from = "2026-10-01T00:00:00.000Z", to = "2026-10-10T23:59:59.999Z";
beforeEach(() => {
  vi.clearAllMocks();
  memberWallets.mockResolvedValue([{ pointTypeId: "p1", balance: 900 }, { pointTypeId: "p2", balance: 12 }]);
  prisma.customPointTransaction.groupBy.mockResolvedValue([{ pointTypeId: "p1", action: "GIVE_IN", _sum: { amount: 35 } }, { pointTypeId: "p1", action: "EXCHANGE", _sum: { amount: -10 } }]);
  prisma.customPointTransaction.findMany.mockResolvedValue([]);
  prisma.$queryRaw.mockResolvedValueOnce([{ pointTypeId: "p1", expired: 5n }]).mockResolvedValueOnce([{ pointTypeId: "p1", balanceAfter: 100 }]).mockResolvedValueOnce([{ pointTypeId: "p1", balanceAfter: 125 }]);
});
describe("member points summary", () => {
  it("returns balances at both boundaries and activities within the range", async () => {
    const app = await appForTest(); const res = await app.inject({ method: "GET", url: `/members/me/credits/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([expect.objectContaining({ pointTypeId: "p1", balance: 900, openingBalance: 100, periodEndBalance: 125, received: 35, redeemed: 10, expired: 5 }), expect.objectContaining({ pointTypeId: "p2", openingBalance: 0, periodEndBalance: 0 })]);
    expect(prisma.customPointTransaction.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ programId: "program-1", memberId: "member-1", createdAt: { gte: new Date(from), lte: new Date(to) } }) }));
    const [expirationSql, startSql, endSql] = prisma.$queryRaw.mock.calls.map(([sql]) => sql);
    expect(startSql.sql).toContain('"createdAt" <'); expect(endSql.sql).toContain('"createdAt" <=');
    expect(expirationSql.sql).toContain('reset."createdAt" <='); expect(expirationSql.values).toContainEqual(new Date(to));
    await app.close();
  });
  it("uses the current balance without an end date", async () => {
    const app = await appForTest(); const res = await app.inject({ method: "GET", url: "/members/me/credits/summary" });
    expect(res.statusCode).toBe(200); expect(res.json().data[0]).toMatchObject({ openingBalance: null, periodEndBalance: 900 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1); await app.close();
  });
});
