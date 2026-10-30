import Fastify from "fastify";
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  member: { count: vi.fn(), findMany: vi.fn() },
  customPointTransaction: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  pointBank: { findMany: vi.fn() }, pointBankTransaction: { groupBy: vi.fn() },
  rewardRedemption: { groupBy: vi.fn() }, reward: { findMany: vi.fn() },
  pointTypeDefinition: { findMany: vi.fn() }, customPointWallet: { groupBy: vi.fn() },
}));
const capability = vi.hoisted(() => vi.fn());
vi.mock("../db.js", () => ({ prisma: db }));
vi.mock("../lib/permissions.js", () => ({ requireCapability: () => async () => {}, assertCapability: capability }));
vi.mock("../lib/wallets.js", () => ({ BANK_CYCLE_RETURN_TYPES: ["RETURN", "PROJECT_RETURN"] }));
import { statsRoutes } from "../routes/stats.js";
import { LoyaltyError } from "../lib/errors.js";

const from = "2026-10-01T00:00:00.000Z", to = "2026-10-15T23:59:59.999Z";
async function appForTest() {
  const app = Fastify();
  app.decorateRequest("programId", "program-1");
  app.setErrorHandler((error, _request, reply) => reply.status(error instanceof LoyaltyError ? error.httpStatus : 500).send({ error: error.message }));
  await app.register(statsRoutes);
  return app;
}
beforeEach(() => {
  vi.clearAllMocks(); capability.mockResolvedValue(undefined);
  db.member.count.mockResolvedValue(0); db.customPointTransaction.groupBy.mockResolvedValue([]); db.customPointTransaction.count.mockResolvedValue(0); db.customPointTransaction.findMany.mockResolvedValue([]);
  db.pointBank.findMany.mockResolvedValue([]); db.pointBankTransaction.groupBy.mockResolvedValue([]); db.rewardRedemption.groupBy.mockResolvedValue([]); db.pointTypeDefinition.findMany.mockResolvedValue([]); db.customPointWallet.groupBy.mockResolvedValue([]);
});
describe("dashboard date filter and details", () => {
  it("uses the selected range for transaction, recognition, bank and reward activity", async () => {
    const app = await appForTest();
    const res = await app.inject({ method: "GET", url: `/stats/dashboard?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` });
    expect(res.statusCode).toBe(200);
    const period = { gte: new Date(from), lte: new Date(to) };
    expect(db.customPointTransaction.count).toHaveBeenCalledWith({ where: { programId: "program-1", createdAt: period } });
    expect(db.pointBankTransaction.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { programId: "program-1", createdAt: period } }));
    expect(db.rewardRedemption.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ redeemedAt: period }) }));
    await app.close();
  });
  it("groups recognition using the selected time zone", async () => {
    db.customPointTransaction.findMany.mockResolvedValue([{ createdAt: new Date("2026-10-01T20:00:00.000Z") }]);
    const app = await appForTest();
    const res = await app.inject({ method: "GET", url: `/stats/dashboard?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&timeZone=Asia%2FHo_Chi_Minh` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.recognitionOverTime).toEqual([{ date: "2026-10-02", count: 1 }]);
    await app.close();
  });
  it("rejects inverted ranges", async () => {
    const app = await appForTest();
    const res = await app.inject({ method: "GET", url: `/stats/dashboard?from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}` });
    expect(res.statusCode).toBe(400); expect(db.customPointTransaction.groupBy).not.toHaveBeenCalled(); await app.close();
  });
  it("does not expose details without the required permission", async () => {
    capability.mockRejectedValueOnce(new LoyaltyError("FORBIDDEN", 403));
    const app = await appForTest();
    const res = await app.inject({ method: "GET", url: `/stats/dashboard/details?metric=pointExchanged&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` });
    expect(res.statusCode).toBe(403);
    expect(db.customPointTransaction.findMany).not.toHaveBeenCalled();
    await app.close();
  });
  it("requires wallet access and filters exchanged details by period", async () => {
    const app = await appForTest();
    const res = await app.inject({ method: "GET", url: `/stats/dashboard/details?metric=pointExchanged&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&page=2` });
    expect(res.statusCode).toBe(200); expect(capability).toHaveBeenCalledWith(expect.anything(), "wallet.view");
    expect(db.customPointTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ programId: "program-1", action: { in: ["EXCHANGE"] }, amount: { lt: 0 }, createdAt: { gte: new Date(from), lte: new Date(to) } }), skip: 20, take: 20 }));
    await app.close();
  });
});
