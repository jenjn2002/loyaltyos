import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  notifyMember: vi.fn(),
  notifyAdmin: vi.fn(),
  notifyAssignees: vi.fn(),
  audit: vi.fn(),
  findOwner: vi.fn(),
  clearPending: vi.fn(),
  clearRead: vi.fn(),
}));

vi.mock("../db.js", () => ({ prisma: {
  approvalRequest: { findFirst: mocks.findOwner },
  adminNotification: { updateMany: mocks.clearPending },
  adminApprovalNotificationRead: { deleteMany: mocks.clearRead },
} }));
vi.mock("../lib/approval-workflows.js", () => ({ decideApprovalRequest: mocks.decide, getApprovalRequest: vi.fn(), listApprovalRequests: vi.fn() }));
vi.mock("../lib/approval-display.js", () => ({ withApprovalDisplay: vi.fn() }));
vi.mock("../lib/audit.js", () => ({ audit: mocks.audit }));
vi.mock("../lib/permissions.js", () => ({ requireCapability: vi.fn(() => async () => undefined) }));
vi.mock("../lib/workflow-integrations.js", () => ({ pointExchangeApprovalHook: vi.fn() }));
vi.mock("../lib/member-notifications.js", () => ({ notifyCreditExchangeDecision: mocks.notifyMember }));
vi.mock("../lib/notifications-setup.js", () => ({ notificationsService: { sendTrigger: vi.fn() } }));
vi.mock("../lib/admin-notifications.js", () => ({ createAdminActivityNotification: mocks.notifyAdmin, notifyApprovalAssignees: mocks.notifyAssignees }));
vi.mock("../workers/occasions.js", () => ({ runOccasions: vi.fn() }));

import { adminApprovalsRoutes } from "../routes/admin/approvals.js";

const approval = {
  id: "approval-1", actionKey: "POINT_EXCHANGE", subjectType: "PointExchangeRequest", subjectId: "exchange-1", status: "APPROVED",
};

describe("admin point exchange approval outcomes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    for (const mock of [mocks.notifyMember, mocks.notifyAdmin, mocks.notifyAssignees, mocks.audit, mocks.clearPending, mocks.clearRead]) mock.mockResolvedValue(undefined);
    mocks.decide.mockResolvedValue(approval);
    mocks.findOwner.mockResolvedValue({ ...approval, requesterAdminId: "requester-1", resolutionComment: "Finance checked" });
    app = Fastify();
    app.decorateRequest("programId", "program-1");
    app.decorateRequest("adminId", "finance-2");
    app.decorateRequest("actor", { type: "ADMIN_USER", id: "finance-2" });
    app.register(adminApprovalsRoutes);
    await app.ready();
  });

  afterEach(async () => app.close());

  it("notifies completion and audits the voucher outcome while keeping the approval approved", async () => {
    const response = await app.inject({ method: "POST", url: "/admin/approvals/approval-1/approve", payload: { comment: "Finance checked" } });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe("APPROVED");
    expect(mocks.notifyMember).toHaveBeenCalledOnce();
    expect(mocks.notifyMember).toHaveBeenCalledWith("program-1", "exchange-1", "COMPLETED");
    expect(mocks.audit).toHaveBeenCalledWith("program-1", { type: "ADMIN_USER", id: "finance-2" }, "CONFIG_CHANGE", "approval_request", "approval-1", expect.objectContaining({
      status: "APPROVED", subjectStatus: "COMPLETED", completionReference: "approval:approval-1",
    }));
    expect(mocks.notifyAdmin).toHaveBeenCalledWith(expect.objectContaining({
      title: "Point exchange completed",
      body: expect.stringContaining("automatically completed after final workflow approval"),
      context: { approval: expect.objectContaining({ status: "approved", subjectStatus: "COMPLETED", comment: expect.stringContaining("automatically completed") }) },
    }));
  });

  it("keeps intermediate approvals pending without sending a final member notification", async () => {
    mocks.decide.mockResolvedValue({ ...approval, status: "PENDING" });
    const response = await app.inject({ method: "POST", url: "/admin/approvals/approval-1/approve", payload: {} });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe("PENDING");
    expect(mocks.notifyAssignees).toHaveBeenCalledWith("program-1", "approval-1");
    expect(mocks.notifyMember).not.toHaveBeenCalled();
    expect(mocks.notifyAdmin).not.toHaveBeenCalled();
    expect(mocks.audit.mock.calls[0]?.[5]).not.toHaveProperty("subjectStatus");
  });

  it("continues to notify rejection without a completion reference", async () => {
    mocks.decide.mockResolvedValue({ ...approval, status: "REJECTED" });
    const response = await app.inject({ method: "POST", url: "/admin/approvals/approval-1/reject", payload: { comment: "Incorrect voucher" } });

    expect(response.statusCode).toBe(200);
    expect(mocks.notifyMember).toHaveBeenCalledOnce();
    expect(mocks.notifyMember).toHaveBeenCalledWith("program-1", "exchange-1", "REJECTED");
    expect(mocks.audit.mock.calls[0]?.[5]).toMatchObject({ status: "REJECTED", subjectStatus: "REJECTED" });
    expect(mocks.audit.mock.calls[0]?.[5]).not.toHaveProperty("completionReference");
    expect(mocks.notifyAdmin.mock.calls[0]?.[0].body).not.toContain("automatically completed");
  });

  it("sends no success notifications or audit when the final transaction fails", async () => {
    mocks.decide.mockRejectedValue(new Error("Completion write failed"));
    const response = await app.inject({ method: "POST", url: "/admin/approvals/approval-1/approve", payload: {} });

    expect(response.statusCode).toBe(500);
    expect(mocks.notifyMember).not.toHaveBeenCalled();
    expect(mocks.notifyAdmin).not.toHaveBeenCalled();
    expect(mocks.clearPending).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
