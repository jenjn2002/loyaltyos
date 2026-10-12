import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  customAttachment: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  project: { findFirst: vi.fn() },
  projectIssueBatch: { findMany: vi.fn() },
  approvalRequest: { findMany: vi.fn() },
  customDocument: { findFirst: vi.fn() },
  transaction: vi.fn(),
  audit: vi.fn().mockResolvedValue(undefined),
  assertCapability: vi.fn(),
  requireCapability: vi.fn(() => async () => undefined),
  assertCustomDocumentAccess: vi.fn(),
  visibleValues: vi.fn(),
  tx: { customAttachment: { create: vi.fn(), findMany: vi.fn() } },
}));

vi.mock("../db.js", () => ({ prisma: {
  customAttachment: mocks.customAttachment,
  project: mocks.project,
  projectIssueBatch: mocks.projectIssueBatch,
  approvalRequest: mocks.approvalRequest,
  customDocument: mocks.customDocument,
  $transaction: mocks.transaction,
} }));
vi.mock("../lib/audit.js", () => ({ audit: mocks.audit }));
vi.mock("../lib/permissions.js", () => ({
  assertCapability: mocks.assertCapability,
  assertAnyCapability: vi.fn(),
  requireCapability: mocks.requireCapability,
}));
vi.mock("../lib/customization.js", () => ({
  assertCustomDocumentAccess: mocks.assertCustomDocumentAccess,
  visibleValues: mocks.visibleValues,
}));

import { LoyaltyError } from "../lib/errors.js";
import { adminAttachmentRoutes } from "../routes/admin/attachments.js";

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=";
const pngBytes = Buffer.from(pngBase64, "base64");

describe("private admin attachments", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.customAttachment.findFirst.mockResolvedValue(null);
    mocks.customAttachment.findMany.mockResolvedValue([]);
    mocks.customAttachment.create.mockResolvedValue({ id: "attachment-1", name: "proof.png", mimeType: "image/png", size: pngBytes.byteLength });
    mocks.project.findFirst.mockResolvedValue(null);
    mocks.projectIssueBatch.findMany.mockResolvedValue([]);
    mocks.approvalRequest.findMany.mockResolvedValue([]);
    mocks.customDocument.findFirst.mockResolvedValue(null);
    mocks.assertCapability.mockResolvedValue(undefined);
    mocks.assertCustomDocumentAccess.mockResolvedValue({ record: { id: "doc-1", values: {} }, definition: {}, fields: [], role: "OWNER" });
    mocks.visibleValues.mockReturnValue({});
    mocks.tx.customAttachment.findMany.mockResolvedValue([]);
    mocks.tx.customAttachment.create.mockResolvedValue({ id: "attachment-1", name: "proof.png", mimeType: "image/png", size: pngBytes.byteLength });
    mocks.transaction.mockImplementation((callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));

    app = Fastify({ logger: false });
    app.decorateRequest("programId", "");
    app.decorateRequest("memberId", null);
    app.decorateRequest("adminId", null);
    app.decorateRequest("apiKeyScope", "");
    app.decorateRequest("actor", { type: "SYSTEM", id: "anonymous" });
    app.addHook("onRequest", async (request) => {
      request.programId = "program-1";
      request.adminId = "admin-1";
      request.apiKeyScope = "SERVER";
    });
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof LoyaltyError) return reply.status(error.httpStatus).send({ error: { code: error.code } });
      const status = (error as { statusCode?: number }).statusCode ?? 500;
      return reply.status(status).send({ error: { code: "INTERNAL_ERROR" } });
    });
    app.register(adminAttachmentRoutes);
    await app.ready();
  });

  it("stores valid project uploads and returns metadata without the blob", async () => {
    mocks.project.findFirst.mockResolvedValue({ id: "project-1", status: "ACTIVE", createdByAdminId: "admin-1" });

    const response = await app.inject({
      method: "POST",
      url: "/admin/attachments",
      payload: { contextType: "PROJECT", contextId: "project-1", name: "../proof.png\r\n", mimeType: "image/png", base64: pngBase64 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toEqual({ id: "attachment-1", name: "proof.png", mimeType: "image/png", size: pngBytes.byteLength });
    expect(JSON.stringify(response.json())).not.toContain(pngBase64);
    expect(mocks.assertCapability).toHaveBeenCalledWith(expect.anything(), "project.manage");
    expect(mocks.tx.customAttachment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        programId: "program-1", contextType: "PROJECT", contextId: "project-1",
        uploadedByAdminId: "admin-1", base64: pngBase64,
      }),
      select: { id: true, name: true, mimeType: true, size: true },
    }));
    expect(mocks.audit).toHaveBeenCalledWith(
      "program-1",
      { type: "SYSTEM", id: "anonymous" },
      "CONFIG_CHANGE",
      "custom_attachment",
      "attachment-1",
      expect.objectContaining({ operation: "UPLOAD", contextType: "PROJECT", contextId: "project-1" }),
      undefined,
      mocks.tx,
    );
  });

  it("rejects unapproved MIME, mismatched content, and active HTML text", async () => {
    const requests = [
      { name: "payload.svg", mimeType: "image/svg+xml", base64: pngBase64 },
      { name: "payload.jpg", mimeType: "image/jpeg", base64: pngBase64 },
      { name: "payload.txt", mimeType: "text/plain", base64: Buffer.from("<html><script>alert(1)</script></html>").toString("base64") },
    ];
    for (const payload of requests) {
      const response = await app.inject({ method: "POST", url: "/admin/attachments", payload: { contextType: "CUSTOM_DOCUMENT", contextId: "doc-1", ...payload } });
      expect(response.statusCode).toBe(400);
    }
    expect(mocks.tx.customAttachment.create).not.toHaveBeenCalled();
  });

  it("enforces project ownership, lifecycle locks, and per-context quotas", async () => {
    mocks.project.findFirst.mockResolvedValueOnce({ id: "project-1", status: "ACTIVE", createdByAdminId: "admin-2" });
    const wrongOwner = await app.inject({ method: "POST", url: "/admin/attachments", payload: { contextType: "PROJECT", contextId: "project-1", name: "proof.png", mimeType: "image/png", base64: pngBase64 } });
    expect(wrongOwner.statusCode).toBe(404);

    mocks.project.findFirst.mockResolvedValueOnce({ id: "project-1", status: "ISSUE_PENDING", createdByAdminId: "admin-1" });
    const pending = await app.inject({ method: "POST", url: "/admin/attachments", payload: { contextType: "PROJECT", contextId: "project-1", name: "proof.png", mimeType: "image/png", base64: pngBase64 } });
    expect(pending.statusCode).toBe(409);

    mocks.project.findFirst.mockResolvedValueOnce({ id: "project-1", status: "ACTIVE", createdByAdminId: "admin-1" });
    mocks.tx.customAttachment.findMany.mockResolvedValueOnce(Array.from({ length: 50 }, () => ({ size: 1 })));
    const quota = await app.inject({ method: "POST", url: "/admin/attachments", payload: { contextType: "PROJECT", contextId: "project-1", name: "proof.png", mimeType: "image/png", base64: pngBase64 } });
    expect(quota.statusCode).toBe(409);
    expect(mocks.tx.customAttachment.create).not.toHaveBeenCalled();
  });

  it("downloads project evidence only for an owner with project view", async () => {
    mocks.customAttachment.findFirst
      .mockResolvedValueOnce({ id: "attachment-1", name: "proof.png", mimeType: "image/png", size: pngBytes.byteLength, contextType: "PROJECT", contextId: "project-1", uploadedByAdminId: "admin-1" })
      .mockResolvedValueOnce({ base64: pngBase64, size: pngBytes.byteLength });
    mocks.project.findFirst.mockResolvedValue({ id: "project-1", createdByAdminId: "admin-1" });

    const response = await app.inject({ method: "GET", url: "/admin/attachments/attachment-1" });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(pngBytes);
    expect(response.headers["content-disposition"]).toContain("attachment;");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(response.headers["content-type"]).toBe("image/png");
    expect(mocks.customAttachment.findFirst.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ select: { base64: true, size: true } }));
  });

  it("does not expose project files to finance-only users without project visibility", async () => {
    mocks.customAttachment.findFirst.mockResolvedValue({ id: "attachment-1", name: "proof.png", mimeType: "image/png", size: pngBytes.byteLength, contextType: "PROJECT", contextId: "project-1", uploadedByAdminId: "admin-2" });
    mocks.project.findFirst.mockResolvedValue({ id: "project-1", createdByAdminId: "admin-2" });
    mocks.assertCapability.mockImplementation(async (_request, capability) => {
      if (capability === "project.view") throw new LoyaltyError("FORBIDDEN", 403);
    });
    mocks.projectIssueBatch.findMany.mockResolvedValue([]);
    mocks.approvalRequest.findMany.mockResolvedValue([]);
    expect((await app.inject({ method: "GET", url: "/admin/attachments/attachment-1" })).statusCode).toBe(404);
    expect(mocks.customAttachment.findFirst).toHaveBeenCalledTimes(1);
  });

  it("allows a matching assigned reviewer to read referenced project evidence only", async () => {
    mocks.customAttachment.findFirst
      .mockResolvedValueOnce({ id: "attachment-1", name: "proof.png", mimeType: "image/png", size: pngBytes.byteLength, contextType: "PROJECT", contextId: "project-1", uploadedByAdminId: "admin-2" })
      .mockResolvedValueOnce({ base64: pngBase64, size: pngBytes.byteLength });
    mocks.project.findFirst.mockResolvedValue({ id: "project-1", createdByAdminId: "admin-2" });
    mocks.assertCapability.mockImplementation(async (_request, capability) => {
      if (capability === "project.view" || capability === "project.finance.view") throw new LoyaltyError("FORBIDDEN", 403);
    });
    mocks.projectIssueBatch.findMany.mockResolvedValue([{ id: "batch-1" }]);
    mocks.approvalRequest.findMany.mockResolvedValue([{
      payload: { evidence: [{ kind: "FILE", attachmentId: "attachment-1" }] },
      steps: [{ assigneesSnapshot: [{ adminId: "admin-1" }], decisions: [] }],
    }]);

    const response = await app.inject({ method: "GET", url: "/admin/attachments/attachment-1" });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(pngBytes);
    expect(mocks.approvalRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ programId: "program-1" }),
      select: expect.objectContaining({ payload: true, steps: expect.any(Object) }),
    }));
  });

  it("does not give a reviewer access to another file in the same project", async () => {
    mocks.customAttachment.findFirst.mockResolvedValue({ id: "attachment-2", name: "other.png", mimeType: "image/png", size: pngBytes.byteLength, contextType: "PROJECT", contextId: "project-1", uploadedByAdminId: "admin-2" });
    mocks.project.findFirst.mockResolvedValue({ id: "project-1", createdByAdminId: "admin-2" });
    mocks.assertCapability.mockImplementation(async (_request, capability) => {
      if (capability === "project.view" || capability === "project.finance.view") throw new LoyaltyError("FORBIDDEN", 403);
    });
    mocks.projectIssueBatch.findMany.mockResolvedValue([{ id: "batch-1" }]);
    mocks.approvalRequest.findMany.mockResolvedValue([{
      payload: { evidence: [{ kind: "FILE", attachmentId: "attachment-1" }] },
      steps: [{ assigneesSnapshot: [{ adminId: "admin-1" }], decisions: [] }],
    }]);

    const response = await app.inject({ method: "GET", url: "/admin/attachments/attachment-2" });

    expect(response.statusCode).toBe(404);
    expect(mocks.customAttachment.findFirst).toHaveBeenCalledTimes(1);
  });

  it("allows a custom-document uploader to read an unused file but not a hidden referenced file", async () => {
    mocks.customAttachment.findFirst
      .mockResolvedValueOnce({ id: "attachment-1", name: "proof.png", mimeType: "image/png", size: pngBytes.byteLength, contextType: "CUSTOM_DOCUMENT", contextId: "doc-1", uploadedByAdminId: "admin-1" })
      .mockResolvedValueOnce({ base64: pngBase64, size: pngBytes.byteLength });
    mocks.assertCustomDocumentAccess.mockResolvedValue({ record: { id: "doc-1", values: {} }, definition: {}, fields: [], role: "OPERATOR" });
    mocks.visibleValues.mockReturnValue({});

    const unused = await app.inject({ method: "GET", url: "/admin/attachments/attachment-1" });
    expect(unused.statusCode).toBe(200);

    mocks.customAttachment.findFirst.mockResolvedValueOnce({ id: "attachment-2", name: "private.png", mimeType: "image/png", size: pngBytes.byteLength, contextType: "CUSTOM_DOCUMENT", contextId: "doc-1", uploadedByAdminId: "admin-2" });
    mocks.assertCustomDocumentAccess.mockResolvedValue({ record: { id: "doc-1", values: { private_proof: { kind: "FILE", attachmentId: "attachment-2" } } }, definition: {}, fields: [], role: "OPERATOR" });
    mocks.visibleValues.mockReturnValue({});

    const hidden = await app.inject({ method: "GET", url: "/admin/attachments/attachment-2" });
    expect(hidden.statusCode).toBe(404);
    expect(mocks.customAttachment.findFirst).toHaveBeenCalledTimes(3);
  });
});
