// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { ui } from "@/lib/ui-text";
import { CreditsManagementPage } from "../credits-management";

const { fetchApi } = vi.hoisted(() => ({ fetchApi: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ fetchApi }));

const voucher = {
  id: "exchange-1", documentNumber: "EXC-2026-0042", payoutType: "CASH",
  valueMinor: 10000, currency: "USD", payoutMechanism: "Bank transfer", status: "COMPLETED",
};
const transaction = {
  id: "tx-exchange", createdAt: "2026-10-07T10:00:00Z", action: "EXCHANGE",
  amount: -100, balanceAfter: 150, actorId: null, actorType: "MEMBER",
  pointType: { code: "P", name: "Points", unitLabel: "points" },
  member: { id: "member-1", firstName: "Dana", lastName: "Member", email: "dana@example.test" },
  exchangeRequestId: voucher.id, exchangeRequest: voucher, reason: null,
};
const clients: QueryClient[] = [];

async function renderTransaction(overrides: Record<string, unknown>, locale = "en-US") {
  await i18n.changeLanguage(locale);
  fetchApi.mockImplementation(async (path: string) => {
    if (path === "/admin/me") return { capabilities: {} };
    if (path.startsWith("/admin/credits/transactions")) {
      return { items: [{ ...transaction, ...overrides }], total: 1, page: 1, totalPages: 1 };
    }
    return [];
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter><CreditsManagementPage section="ledger" /></MemoryRouter></QueryClientProvider>);
  return screen.findByRole("row", { name: /Dana Member/ });
}

function expectReason(row: HTMLElement, reason: string) {
  expect(within(row).getAllByRole("cell")[5]?.textContent).toBe(reason);
  const summary = within(row).getByText(ui("Transaction details"), { selector: "summary" });
  fireEvent.click(summary);
  const details = summary.closest("details")!;
  expect(details.open).toBe(true);
  expect(within(details).getByText(reason, { selector: "dd" })).toBeTruthy();
}

beforeEach(() => {
  fetchApi.mockReset();
});
afterEach(async () => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  await i18n.changeLanguage("en-US");
});

describe("exchange ledger reasons", () => {
  it.each([
    { locale: "en-US", payoutType: "CASH", expected: "Point exchange: EXC-2026-0042 · Cash" },
    { locale: "en-US", payoutType: "NON_CASH", expected: "Point exchange: EXC-2026-0042 · Non-cash" },
    { locale: "vi-VN", payoutType: "CASH", expected: "Đổi điểm: EXC-2026-0042 · Tiền mặt" },
    { locale: "vi-VN", payoutType: "NON_CASH", expected: "Đổi điểm: EXC-2026-0042 · Phi tiền mặt" },
  ])("derives a missing $payoutType reason from its voucher in $locale", async ({ locale, payoutType, expected }) => {
    const row = await renderTransaction({ exchangeRequest: { ...voucher, payoutType } }, locale);
    expectReason(row, expected);
  });

  it("localizes the exact generated reason using structured voucher context", async () => {
    const row = await renderTransaction({ reason: "Point exchange: EXC-2026-0042 · Non-cash", exchangeRequest: { ...voucher, payoutType: "NON_CASH" } }, "vi-VN");
    expectReason(row, "Đổi điểm: EXC-2026-0042 · Phi tiền mặt");
  });

  it("uses metadata when a legacy exchange has no linked voucher", async () => {
    const row = await renderTransaction({ reason: "  ", exchangeRequest: null, metadata: { documentNumber: "EXC-LEGACY", payoutType: "NON_CASH" } });
    expectReason(row, "Point exchange: EXC-LEGACY · Non-cash");
  });

  it.each([
    { locale: "en-US", metadata: { payoutType: "CASH" }, expected: "Point exchange · Cash" },
    { locale: "vi-VN", metadata: { payoutType: "NON_CASH" }, expected: "Đổi điểm · Phi tiền mặt" },
    { locale: "vi-VN", metadata: null, expected: "Đổi điểm" },
  ])("keeps an exchange readable without a voucher or document number in $locale", async ({ locale, metadata, expected }) => {
    const row = await renderTransaction({ exchangeRequest: null, metadata }, locale);
    expectReason(row, expected);
  });

  it.each(["Office supplies reimbursement", "Point exchange: EXC-MANUAL · Cash"])("preserves a manually recorded reason: %s", async (reason) => {
    const row = await renderTransaction({ reason }, "vi-VN");
    expectReason(row, reason);
  });

  it("leaves other ledger actions unchanged", async () => {
    const row = await renderTransaction({ action: "REDEEM", exchangeRequest: null, reason: null });
    expect(within(row).getAllByRole("cell")[5]?.textContent).toBe("—");
  });
});
