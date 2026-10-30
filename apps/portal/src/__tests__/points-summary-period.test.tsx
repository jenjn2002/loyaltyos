// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PointsDashboard } from "../pages/home";
const { fetchApi } = vi.hoisted(() => ({ fetchApi: vi.fn() }));
vi.mock("@/lib/ui-text", () => ({ ui: (value: string) => value }));
vi.mock("../lib/api-client", () => ({ fetchApi, postApi: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("shows historical opening and closing balances and activities when dates are selected", async () => {
  fetchApi.mockImplementation(async (path: string) => {
    const params = new URL(path, "http://local").searchParams;
    return [{ pointTypeId: "p1", name: "R-credit", unitLabel: "points", balance: 900, openingBalance: params.has("from") ? 100 : null, periodEndBalance: params.has("to") ? 125 : 900, received: 35, sent: 0, redeemed: 10, expired: 5 }];
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PointsDashboard enabled /></QueryClientProvider>);
  const section = await screen.findByRole("region", { name: "Points overview" });
  expect(await within(section).findByText("900")).toBeTruthy();
  fireEvent.change(within(section).getByLabelText("From date and time"), { target: { value: "2026-10-01T08:10:11" } });
  fireEvent.change(within(section).getByLabelText("To date and time"), { target: { value: "2026-10-10T14:20:30" } });
  await waitFor(() => expect(within(section).getByText("Balance at end of period")).toBeTruthy());
  expect(await within(section).findByText("125")).toBeTruthy();
  expect(within(section).getByText(/Balance at start of period/).textContent).toContain("100");
  expect(within(section).getByRole("img", { name: "Received: 35 points" })).toBeTruthy();
  const request = fetchApi.mock.calls.map(([path]) => new URL(path as string, "http://local")).find((url) => url.searchParams.has("from") && url.searchParams.has("to"));
  expect(request?.searchParams.get("from")).toBe(new Date("2026-10-01T08:10:11").toISOString());
  const end = new Date("2026-10-10T14:20:30"); end.setMilliseconds(999);
  expect(request?.searchParams.get("to")).toBe(end.toISOString());
  client.clear();
});

it("rejects an inverted time range within the same day", async () => {
  fetchApi.mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PointsDashboard enabled /></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText("From date and time"), { target: { value: "2026-10-01T15:00:00" } });
  fireEvent.change(screen.getByLabelText("To date and time"), { target: { value: "2026-10-01T14:00:00" } });
  expect(screen.getByRole("alert").textContent).toBe("Start time must be on or before end time.");
  client.clear();
});
