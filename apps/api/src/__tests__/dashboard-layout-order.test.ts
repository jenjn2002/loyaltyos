import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));
vi.mock("../db.js", () => ({ prisma: { adminDashboardPreference: store } }));
vi.mock("../lib/permissions.js", () => ({ requireCapability: () => async () => {} }));
import { adminDashboardRoutes } from "../routes/admin/dashboard.js";
async function appForTest() { const app = Fastify(); app.decorateRequest("adminId", "admin-1"); app.decorateRequest("programId", "program-1"); await app.register(adminDashboardRoutes); return app; }
describe("dashboard ordering", () => {
  it("persists and returns the per-admin order", async () => {
    const app = await appForTest(); const widgets = [{ id: "one", metric: "pointExchanged", title: "Exchange" }]; const order = ["pointExchanged", "custom:one", "pointsChart"];
    store.upsert.mockResolvedValue({ widgets, layoutOrder: order });
    const res = await app.inject({ method: "PATCH", url: "/admin/dashboard-layout", payload: { widgets, order } });
    expect(res.statusCode).toBe(200); expect(res.json().data.order).toEqual(order);
    expect(store.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { programId_adminUserId: { programId: "program-1", adminUserId: "admin-1" } }, update: { widgets, layoutOrder: order } })); await app.close();
  });
  it("retains existing order for older clients that only save widgets", async () => {
    const app = await appForTest(); store.upsert.mockResolvedValue({ widgets: [], layoutOrder: ["pointsChart"] });
    const res = await app.inject({ method: "PATCH", url: "/admin/dashboard-layout", payload: { widgets: [] } });
    expect(res.statusCode).toBe(200); expect(res.json().data.order).toEqual(["pointsChart"]);
    expect(store.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { widgets: [] } })); await app.close();
  });
});
