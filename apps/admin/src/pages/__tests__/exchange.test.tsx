// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { CreditsManagementPage } from "../credits-management";

const { fetchApi } = vi.hoisted(() => ({ fetchApi: vi.fn(async (path: string) => path.includes("exchange-requests") ? { items: [], total: 41, totalPages: 3 } : []) }));
vi.mock("@/lib/ui-text", () => ({ ui: (value: string) => value }));
vi.mock("@/lib/api-client", () => ({ fetchApi }));
afterEach(cleanup);

it("separates rates from vouchers and filters all pages on the server", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><CreditsManagementPage section="exchange" /></MemoryRouter></QueryClientProvider>);
  await screen.findByText("No exchange requests.");
  expect(screen.queryByRole("button", { name: "Activate new rate version" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(fetchApi).toHaveBeenCalledWith("/admin/credits/exchange-requests?page=2&pageSize=20"));
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "PENDING" } });
  await waitFor(() => expect(fetchApi).toHaveBeenCalledWith("/admin/credits/exchange-requests?page=1&pageSize=20&status=PENDING"));
  fireEvent.click(screen.getByRole("button", { name: "Exchange rates" }));
  expect(screen.getByRole("button", { name: "Activate new rate version" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  client.clear();
});
