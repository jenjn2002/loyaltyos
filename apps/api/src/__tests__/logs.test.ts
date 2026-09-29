import Fastify from "fastify";
import { describe, it, expect, vi } from "vitest";

const db = vi.hoisted(() => Object.fromEntries([
  "auditLog", "adminUser", "member", "apiKey", "campaign", "coupon", "reward", "segment", "tier", "badge", "eventDefinition", "approvalWorkflow", "approvalRequest", "pointTypeDefinition", "pointBankCycle", "project", "projectTask",
].map((key) => [key, { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(1) }])));
vi.mock("../db.js", () => ({ prisma: db }));
vi.mock("../lib/permissions.js", () => ({ requireCapability: () => async () => undefined }));
import { adminLogsRoutes } from "../routes/admin/logs.js";

describe("project audit targets", () => {
  it("finds project targets by name within the program and returns readable labels", async () => {
    db.auditLog!.findMany.mockResolvedValue([{ id: "log-1", actorType: "SYSTEM", actorId: "system", entityType: "project", entityId: "project-1", diff: {}, action: "CONFIG_CHANGE" }]);
    db.project!.findMany.mockResolvedValue([{ id: "project-1", name: "Internal Launch" }]);
    const app = Fastify();
    app.decorateRequest("programId", "program-1");
    app.register(adminLogsRoutes);
    try {
      const response = await app.inject({ method: "GET", url: "/admin/logs?q=Launch" });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.items[0].targetLabel).toBe("Internal Launch");
      expect(db.project!.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { programId: "program-1", name: { contains: "Launch", mode: "insensitive" } } }));
      expect(db.auditLog!.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ programId: "program-1", AND: expect.arrayContaining([expect.objectContaining({ OR: expect.arrayContaining([{ entityType: "project", entityId: { in: ["project-1"] } }]) })]) }) }));
    } finally { await app.close(); }
  });
});
