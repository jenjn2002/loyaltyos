import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Transactions from "../pages/transactions";

function transaction(id: string) {
  return {
    id,
    action: "EARN",
    amount: 10,
    balanceAfter: 10,
    source: "campaign:campaign-1",
    reason: `Campaign grant: ${id}`,
    message: null,
    pointType: { id: "point-type-1", code: "P", name: "Purchase", unitLabel: "P", color: null },
    createdAt: "2026-09-25T00:00:00.000Z",
  };
}

describe("Transactions", () => {
  it("loads the next page of member transaction history", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin);
      const page = Number(url.searchParams.get("page"));
      const data = {
        items: [transaction(page === 1 ? "transaction-1" : "transaction-2")],
        page,
        pageSize: 50,
        total: 51,
        totalPages: 2,
      };
      return Promise.resolve(
        new Response(JSON.stringify({ data }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Transactions />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Campaign grant: transaction-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("Campaign grant: transaction-2")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("page=2&pageSize=50");
  });
});
