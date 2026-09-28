// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { markAllRead, markRead } = vi.hoisted(() => ({
  markAllRead: vi.fn(),
  markRead: vi.fn(),
}));

vi.mock("@/components/layout/admin-notification-context", () => ({
  useAdminNotifications: () => ({
    isReady: true,
    markAllRead,
    markRead,
  }),
}));

vi.mock("@/lib/api-client", () => ({
  fetchApi: async (path: string) => {
    if (path === "/admin/me") return { id: "admin-1" };
    if (path === "/admin/approvals/inbox") {
      return [
        {
          id: "approval-1",
          actionKey: "CAMPAIGN_ISSUANCE",
          status: "PENDING",
          subjectType: "CAMPAIGN",
          subjectId: "campaign-1",
          requestedByType: "ADMIN",
          requestedById: "admin-2",
          requestedAt: "2026-09-25T10:00:00.000Z",
          currentStepOrder: 1,
          workflow: { actionKey: "CAMPAIGN_ISSUANCE", name: "Campaign approval" },
          steps: [],
        },
        {
          id: "approval-2",
          actionKey: "POINT_ISSUANCE",
          status: "PENDING",
          subjectType: "MEMBER",
          subjectId: "member-1",
          requestedByType: "ADMIN",
          requestedById: "admin-2",
          requestedAt: "2026-09-25T10:01:00.000Z",
          currentStepOrder: 1,
          workflow: { actionKey: "POINT_ISSUANCE", name: "Point approval" },
          steps: [],
        },
      ];
    }
    if (path === "/admin/approvals/history") return [];
    if (path === "/admin/approvals/approval-1") {
      return {
        id: "approval-1",
        actionKey: "CAMPAIGN_ISSUANCE",
        status: "PENDING",
        subjectType: "CAMPAIGN",
        subjectId: "campaign-1",
        requestedByType: "ADMIN",
        requestedById: "admin-2",
        requestedAt: "2026-09-25T10:00:00.000Z",
        currentStepOrder: 1,
        workflow: { actionKey: "CAMPAIGN_ISSUANCE", name: "Campaign approval" },
        steps: [],
      };
    }
    return {};
  },
}));

import { ApprovalsPage } from "../approvals";

describe("ApprovalsPage notification read state", () => {
  beforeEach(() => {
    markAllRead.mockClear();
    markRead.mockClear();
  });

  it("does not mark unrelated approvals read just by opening the inbox", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ApprovalsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const campaignApproval = await screen.findByText("Campaign approval");
    await screen.findByText("Point approval");
    expect(markAllRead).not.toHaveBeenCalled();

    fireEvent.click(campaignApproval);
    await waitFor(() => expect(markRead).toHaveBeenCalledWith("approval-1"));
    expect(markAllRead).not.toHaveBeenCalled();
  });
});
