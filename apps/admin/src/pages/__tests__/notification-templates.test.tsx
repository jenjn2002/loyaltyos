// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ui-text", () => ({ ui: (value: string) => value }));
vi.mock("@/lib/api-client", () => ({
  fetchApi: async (path: string) => {
    if (path === "/admin/me") return { capabilities: { "notification.manage": true } };
    if (path === "/admin/notification-templates/triggers") {
      return ["integration.member_anniversary", "credit.admin_issued", "reward.redemption.rejected"];
    }
    if (path.startsWith("/admin/notification-templates?")) {
      return {
        items: [{
          id: "template-1",
          name: "Member anniversary",
          locale: "vi-VN",
          channel: "IN_APP",
          subject: "Chúc mừng ngày kỷ niệm",
          bodyHtml: null,
          bodyText: "Chúc mừng {{member.firstName}}",
          triggerEvent: "integration.member_anniversary",
          transactional: false,
          fallbackChannel: null,
          createdAt: "2026-10-01T00:00:00.000Z",
        }],
        total: 1,
        page: 1,
        pageSize: 100,
        totalPages: 1,
      };
    }
    return {};
  },
}));

import { NotificationTemplatesPage } from "../notification-templates";

afterEach(cleanup);

describe("notification template trigger catalog", () => {
  it("loads saved trigger keys into create/edit and documents variables for runtime events", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><NotificationTemplatesPage /></MemoryRouter>
      </QueryClientProvider>,
    );

    const triggerSelect = await screen.findByLabelText("Notification type");
    expect(within(triggerSelect).getByRole("option", { name: /Integration Member Anniversary/ })).toBeTruthy();
    expect(within(triggerSelect).getByRole("option", { name: /Admin-issued points/ })).toBeTruthy();
    expect(within(triggerSelect).getByRole("option", { name: /Reward redemption rejected/ })).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Edit translations" }));
    expect((triggerSelect as HTMLSelectElement).value).toBe("integration.member_anniversary");

    fireEvent.change(triggerSelect, { target: { value: "reward.fulfillment_changed" } });
    expect(await screen.findByText("{{reward.name}}")).toBeTruthy();
    expect(screen.getByText("{{statusLabel}}")).toBeTruthy();

    fireEvent.change(triggerSelect, { target: { value: "credit.redeemed" } });
    expect(screen.getByText("{{pointType.name}}")).toBeTruthy();

    fireEvent.change(triggerSelect, { target: { value: "credit.admin_issued" } });
    expect(screen.getByText("{{reason}}")).toBeTruthy();
    client.clear();
  });
});
