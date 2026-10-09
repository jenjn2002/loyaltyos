import { describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({ prisma: {} }));

import {
  approvalActionLabels,
  approvalResolutionNotificationCopy,
  findLegacyApprovalResolutionCandidate,
  isLegacyApprovalResolutionNotification,
} from "../lib/approval-display.js";

describe("approval resolution notification copy", () => {
  it("uses a human action and campaign name in both supported locales", () => {
    const en = approvalResolutionNotificationCopy({
      actionKey: "CAMPAIGN_ISSUANCE_PROPOSAL",
      subjectType: "CAMPAIGN_ISSUANCE",
      subjectName: "Welcome campaign",
      status: "APPROVED",
      locale: "en-US",
    });
    const vi = approvalResolutionNotificationCopy({
      actionKey: "CAMPAIGN_ISSUANCE_PROPOSAL",
      subjectType: "CAMPAIGN_ISSUANCE",
      subjectName: "Welcome campaign",
      status: "APPROVED",
      locale: "vi-VN",
    });

    expect(en.title).toBe("Welcome campaign · Approved");
    expect(en.body).toBe("Campaign “Welcome campaign” was approved.");
    expect(vi.title).toBe("Welcome campaign · Đã phê duyệt");
    expect(vi.body).toBe("Chiến dịch “Welcome campaign” đã được phê duyệt.");
    expect(en.body).not.toContain("CAMPAIGN_ISSUANCE");
  });

  it("recognizes only the built-in legacy approval copy for safe presentation updates", () => {
    const legacy = {
      title: "Yêu cầu CAMPAIGN_ISSUANCE_PROPOSAL đã được phê duyệt",
      body: "Yêu cầu phê duyệt CAMPAIGN_ISSUANCE_PROPOSAL cho CAMPAIGN_ISSUANCE được phê duyệt.",
      actionKey: "CAMPAIGN_ISSUANCE_PROPOSAL",
      subjectType: "CAMPAIGN_ISSUANCE",
      status: "APPROVED",
    };
    expect(isLegacyApprovalResolutionNotification(legacy)).toBe(true);
    expect(isLegacyApprovalResolutionNotification({ ...legacy, body: "Custom notification content" })).toBe(false);
  });

  it("links old project-path notifications only to the matching nearby resolved approval", () => {
    const createdAt = new Date("2026-10-08T03:04:29.000Z");
    const candidate = {
      id: "approval-1",
      actionKey: "PROJECT_PLAN_APPROVAL",
      status: "APPROVED",
      subjectType: "Project",
      subjectId: "project-1",
      resolutionComment: null,
      resolvedAt: new Date("2026-10-08T03:04:00.000Z"),
      payload: {},
    };

    expect(findLegacyApprovalResolutionCandidate({
      entityType: "Project",
      entityId: "project-1",
      title: "Yêu cầu PROJECT_PLAN_APPROVAL đã được phê duyệt",
      body: "Yêu cầu phê duyệt PROJECT_PLAN_APPROVAL cho Project được phê duyệt.",
      createdAt,
    }, [
      { ...candidate, id: "wrong-project", subjectId: "project-2" },
      { ...candidate, id: "wrong-action", actionKey: "PROJECT_POINT_ISSUANCE" },
      { ...candidate, id: "too-old", resolvedAt: new Date("2026-10-08T02:53:00.000Z") },
      candidate,
    ])?.id).toBe("approval-1");
  });

  it("falls back to human action labels for unknown user-facing workflow keys", () => {
    expect(approvalActionLabels("CUSTOM_ACTION_42")).toEqual({
      "en-US": "Approval request",
      "vi-VN": "Yêu cầu phê duyệt",
    });
  });
});
