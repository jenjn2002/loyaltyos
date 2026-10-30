// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LogsPage } from "../logs";
vi.mock("@/lib/ui-text", () => ({ ui: (value: string) => value }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "vi-VN" } }) }));
vi.mock("@/lib/api-client", () => ({ fetchApi: async (path: string) => path.startsWith("/admin/logs/filters") ? { features: [] } : { total: 1, page: 1, pageSize: 25, totalPages: 1, items: [{ id: "log-1", actorType: "ADMIN_USER", actorId: "admin", action: "CONFIG_CHANGE", entityType: "point_bank_cycle", entityId: "cycle", targetLabel: "R-credit cycle", reason: null, createdAt: "2026-10-30T10:20:30.000Z", actor: { type: "ADMIN_USER", id: "admin", name: "Admin", email: null }, diff: { endsAt: "2026-10-30T09:10:00.000Z", previousEndsAt: "2026-10-30T23:59:59.999Z", startsAt: "2026-10-28T00:00:00.000Z", nested: { note: "2026-10-28" } } }] } }));
afterEach(cleanup);
it("shows recorded UTC timestamps in local time with seconds and retains raw audit data", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><LogsPage /></QueryClientProvider>);
  fireEvent.click(await screen.findByText("R-credit cycle"));
  const value = (label: string) => screen.getByText(label).parentElement!.querySelector("dd")!;
  expect(value("Ends At").textContent).toContain("16:10:00");
  expect(value("Ends At").textContent).toContain("GMT+7");
  expect(value("Ends At").querySelector("span")?.title).toBe("2026-10-30T09:10:00.000Z");
  expect(value("Previous Ends At").textContent).toContain("06:59:59");
  expect(value("Starts At").textContent).toContain("07:00:00");
  expect(value("Note").textContent).toBe("2026-10-28");
  expect(screen.getByText(/"endsAt": "2026-10-30T09:10:00.000Z"/)).toBeTruthy();
  client.clear();
});
