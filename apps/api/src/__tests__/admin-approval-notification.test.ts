import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findExisting: vi.fn(),
  findAdmin: vi.fn(),
  findProgram: vi.fn(),
  findTemplates: vi.fn(),
  createNotification: vi.fn(),
  queueAdd: vi.fn(),
}));

vi.mock("../db.js", () => ({
  prisma: {
    adminNotification: { findUnique: mocks.findExisting, create: mocks.createNotification },
    adminUser: { findFirst: mocks.findAdmin },
    program: { findUnique: mocks.findProgram },
    notificationTemplate: { findMany: mocks.findTemplates },
  },
}));
vi.mock("../lib/notifications-setup.js", () => ({
  emailNotificationProvider: {},
  notificationsQueue: { add: mocks.queueAdd },
}));
vi.mock("../lib/notification-delivery-audit.js", () => ({ auditAdminNotificationDeliveryFailure: vi.fn() }));

import { createAdminActivityNotification } from "../lib/admin-notifications.js";

const templates = [
  {
    name: "admin-approval-resolved-in-app", locale: "en-US", channel: "IN_APP",
    subject: "{{approval.subjectName}} · {{approval.statusLabel}}",
    bodyText: "{{approval.actionLabel}} “{{approval.subjectName}}” was {{approval.statusLabel}}. {{approval.comment}}",
  },
  {
    name: "admin-approval-resolved-in-app", locale: "vi-VN", channel: "IN_APP",
    subject: "{{approval.subjectName}} · {{approval.statusLabel}}",
    bodyText: "{{approval.actionLabel}} “{{approval.subjectName}}” đã {{approval.statusLabel}}. {{approval.comment}}",
  },
  {
    name: "admin-approval-resolved", locale: "en-US", channel: "EMAIL",
    subject: "{{approval.subjectName}} · {{approval.statusLabel}}",
    bodyText: "{{approval.actionLabel}} “{{approval.subjectName}}” was {{approval.statusLabel}}. {{approval.comment}}",
  },
  {
    name: "admin-approval-resolved", locale: "vi-VN", channel: "EMAIL",
    subject: "{{approval.subjectName}} · {{approval.statusLabel}}",
    bodyText: "{{approval.actionLabel}} “{{approval.subjectName}}” đã {{approval.statusLabel}}. {{approval.comment}}",
  },
];

describe("admin approval notification locale and display context", () => {
  beforeEach(() => {
    mocks.findExisting.mockReset().mockResolvedValue(null);
    mocks.findAdmin.mockReset();
    mocks.findProgram.mockReset().mockResolvedValue({ defaultLocale: "vi-VN" });
    mocks.findTemplates.mockReset().mockImplementation(({ where }) => templates.filter((template) =>
      template.locale === where.locale.in[0] && where.channel.in.includes(template.channel),
    ));
    mocks.createNotification.mockReset().mockImplementation(({ data }) => Promise.resolve({ id: "notice-1", ...data }));
    mocks.queueAdd.mockReset().mockResolvedValue(undefined);
  });

  it.each([
    { locale: "en-US", expectedTitle: "Welcome campaign · approved", expectedBody: "Campaign “Welcome campaign” was approved." },
    { locale: "vi-VN", expectedTitle: "Welcome campaign · được phê duyệt", expectedBody: "Chiến dịch “Welcome campaign” đã được phê duyệt." },
  ])("renders campaign resolution copy in the admin profile locale $locale", async ({ locale, expectedTitle, expectedBody }) => {
    mocks.findAdmin.mockResolvedValue({ id: "admin-1", email: "qa@example.invalid", locale });

    await createAdminActivityNotification({
      programId: "program-1",
      adminUserId: "admin-1",
      triggerEvent: "admin.approval.resolved",
      idempotencyKey: "approval-resolved-1",
      title: "Approval request resolved",
      body: "An approval request was resolved.",
      context: {
        approval: {
          actionKey: "CAMPAIGN_ISSUANCE_PROPOSAL",
          actionLabels: { "en-US": "Campaign", "vi-VN": "Chiến dịch" },
          status: "approved",
          subjectType: "CAMPAIGN_ISSUANCE",
          subjectName: "Welcome campaign",
          comment: "",
        },
      },
    });

    expect(mocks.findTemplates).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ locale: { in: expect.arrayContaining([locale]) } }) }));
    expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: expectedTitle, body: expectedBody }) }));
  });
});
