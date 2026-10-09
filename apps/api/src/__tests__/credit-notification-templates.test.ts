import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsert, updateMany } = vi.hoisted(() => ({ upsert: vi.fn(), updateMany: vi.fn() }));

vi.mock("../db.js", () => ({
  prisma: {
    program: { findMany: vi.fn().mockResolvedValue([{ id: "program-1" }]) },
    notificationTemplate: { upsert, updateMany },
  },
}));
vi.mock("../lib/queue.js", () => ({ createQueue: () => ({ add: vi.fn() }) }));

import { ensureCreditNotificationTemplates } from "../lib/credit-setup.js";

describe("default admin point issuance notification templates", () => {
  beforeEach(() => { upsert.mockClear(); updateMany.mockClear(); });

  it("seeds distinct Vietnamese and English email and in-app messages", async () => {
    await ensureCreditNotificationTemplates();

    const templates = upsert.mock.calls
      .map(([input]) => input.create)
      .filter((template) => template.triggerEvent === "credit.admin_issued");

    expect(templates).toHaveLength(4);
    expect(templates).toEqual(expect.arrayContaining([
      expect.objectContaining({ locale: "vi-VN", channel: "EMAIL", bodyText: expect.stringContaining("{{reason}}") }),
      expect.objectContaining({ locale: "en-US", channel: "EMAIL", bodyText: expect.stringContaining("{{reason}}") }),
      expect.objectContaining({ locale: "vi-VN", channel: "IN_APP", bodyText: expect.stringContaining("{{pointType.name}}") }),
      expect.objectContaining({ locale: "en-US", channel: "IN_APP", bodyText: expect.stringContaining("{{pointType.name}}") }),
    ]));
  });
});

describe("approval workflow notification templates", () => {
  beforeEach(() => { upsert.mockClear(); updateMany.mockClear(); });

  it("seeds bilingual templates for newly assigned and resolved approval work", async () => {
    await ensureCreditNotificationTemplates();

    const templates = upsert.mock.calls.map(([input]) => input.create);
    for (const triggerEvent of ["admin.approval.pending", "admin.approval.resolved", "admin.exchange.pending"]) {
      const matching = templates.filter((template) => template.triggerEvent === triggerEvent);
      expect(matching).toHaveLength(4);
      expect(matching).toEqual(expect.arrayContaining([
        expect.objectContaining({ locale: "vi-VN", channel: "EMAIL" }),
        expect.objectContaining({ locale: "en-US", channel: "EMAIL" }),
        expect.objectContaining({ locale: "vi-VN", channel: "IN_APP" }),
        expect.objectContaining({ locale: "en-US", channel: "IN_APP" }),
      ]));
    }
  });

  it("updates only the exact built-in legacy approval-resolution templates", async () => {
    await ensureCreditNotificationTemplates();

    const updates = updateMany.mock.calls.map(([input]) => input).filter((input) => input.where.triggerEvent === "admin.approval.resolved");
    expect(updates).toHaveLength(4);
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        where: expect.objectContaining({
          name: "admin-approval-resolved-in-app",
          locale: "vi-VN",
          channel: "IN_APP",
          bodyHtml: null,
          subject: "Yêu cầu {{approval.actionKey}} đã {{approval.statusLabel}}",
        }),
        data: expect.objectContaining({ subject: "{{approval.subjectName}} · {{approval.statusLabel}}" }),
      }),
      expect.objectContaining({
        where: expect.objectContaining({
          name: "admin-approval-resolved",
          locale: "en-US",
          channel: "EMAIL",
          bodyHtml: null,
          subject: "{{approval.actionKey}} request {{approval.statusLabel}}",
        }),
        data: expect.objectContaining({ subject: "{{approval.subjectName}} · {{approval.statusLabel}}" }),
      }),
    ]));
  });
});
