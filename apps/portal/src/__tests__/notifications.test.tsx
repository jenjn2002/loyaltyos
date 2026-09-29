import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../lib/i18n";
import Notifications from "../pages/notifications";

describe("Project notifications", () => {
  beforeEach(async () => { await i18n.changeLanguage("en-US"); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("opens the invited project and marks only that notification read", async () => {
    const notification = {
      id: "invitation-1", subject: "Project invitation", body: "Join Launch",
      status: "SENT", isRead: false, createdAt: "2026-09-28T10:00:00Z",
      metadata: { projectId: "project-1" },
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return Response.json({ data: { ...notification, isRead: true } });
      if (url.includes("unread-count")) return Response.json({ data: { unreadCount: 1 } });
      return Response.json({ data: { items: [notification], page: 1, pageSize: 10, total: 1, totalPages: 1 } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/notifications"]}>
      <Routes><Route path="/notifications" element={<Notifications />} /><Route path="/projects" element={<p>Project workspace</p>} /></Routes>
    </MemoryRouter></QueryClientProvider>);

    const link = await screen.findByRole("link", { name: "View project" });
    expect(link).toHaveAttribute("href", "/projects?project=project-1");
    fireEvent.click(link);
    expect(await screen.findByText("Project workspace")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/members/me/notifications/invitation-1"),
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ read: true }) }),
    ));
    client.clear();
  });
});
