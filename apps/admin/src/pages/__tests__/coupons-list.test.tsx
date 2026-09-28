// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchApi } = vi.hoisted(() => ({ fetchApi: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ fetchApi }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange }: { value: string; onValueChange: (value: string) => void }) => (
    <select aria-label="Coupon mode filter" value={value} onChange={(event) => onValueChange(event.target.value)}>
      <option value="all">All modes</option>
      <option value="SHARED">Shared</option>
      <option value="INDIVIDUAL">Individual</option>
      <option value="LIMITED">Limited</option>
    </select>
  ),
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

import { CouponsListPage } from "../coupons-list";

describe("CouponsListPage filters", () => {
  beforeEach(() => {
    fetchApi.mockReset();
    fetchApi.mockImplementation(async (path: string) => {
      const params = new URLSearchParams(path.split("?")[1]);
      const page = Number(params.get("page") ?? 1);
      const filtered = params.has("mode");
      return {
        items: [{
          id: "coupon-1",
          code: "TEST-COUPON",
          discountType: "PERCENTAGE",
          discountValue: 10,
          mode: "SHARED",
          usedCount: 0,
          maxUses: null,
          isActive: true,
          expiresAt: null,
          createdBy: null,
        }],
        total: filtered ? 0 : 21,
        page,
        pageSize: 20,
        totalPages: filtered ? 1 : 2,
      };
    });
  });

  it("returns to the first page when the coupon mode filter changes", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CouponsListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const nextButton = await screen.findByRole("button", { name: "Kế tiếp" });
    fireEvent.click(nextButton);
    await waitFor(() => expect(fetchApi).toHaveBeenCalledWith(expect.stringContaining("page=2")));

    fireEvent.change(screen.getByLabelText("Coupon mode filter"), { target: { value: "SHARED" } });

    await waitFor(() => {
      expect(fetchApi).toHaveBeenCalledWith(expect.stringContaining("page=1"));
      expect(fetchApi).toHaveBeenCalledWith(expect.stringContaining("mode=SHARED"));
    });
  });
});
