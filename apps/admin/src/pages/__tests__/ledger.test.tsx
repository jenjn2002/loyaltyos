// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreditsManagementPage } from "../credits-management";

vi.mock("@/lib/ui-text", () => ({ ui: (value: string) => value }));
vi.mock("@/lib/api-client", () => ({ fetchApi: async (path: string) => {
  if (path.startsWith("/admin/credits/transactions")) return { items: [{ id: "tx-1", createdAt: "2026-09-29T10:00:00Z", action: "GRANT", amount: 100, balanceAfter: 250, actorId: "admin-1", actor: { name: "Admin Test", email: "admin@example.test", type: "ADMIN_USER" }, pointType: { code: "P" }, member: { id: "member-1", firstName: "Test", lastName: "Member", email: "test@example.test" }, source: "project:project-1", sourceLabel: "Welcome project", reason: "Recognition" }], total: 1, totalPages: 1 };
  return [];
} }));
afterEach(cleanup);

describe("ledger details", () => {
  it("shows readable actor, source and reconciled before/after balances", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><CreditsManagementPage section="ledger" /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText("Welcome project")).toBeTruthy();
    expect(screen.getByText("Admin Test · admin@example.test")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Reason" })).toBeTruthy();
    const ledgerRow = screen.getByRole("row", { name: /Test Member/ });
    const cells = within(ledgerRow).getAllByRole("cell");
    expect(cells[3]?.textContent?.trim()).toBe("Test Member");
    expect(cells[5]?.textContent?.trim()).toBe("Recognition");
    expect(screen.getByText("150")).toBeTruthy();
    expect(screen.getByText("250")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-09-30" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-09-01" } });
    expect(screen.getByRole("alert").textContent).toContain("End date must be on or after start date");
    expect(screen.queryByText("Welcome project")).toBeNull();
    client.clear();
  });
});
