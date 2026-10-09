// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchApi } = vi.hoisted(() => ({ fetchApi: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ fetchApi }));
vi.mock("@/lib/ui-text", () => ({ ui: (text: string) => text }));

import { CouponBulkGeneratePage } from "../coupon-bulk-generate";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverStub,
});

describe("CouponBulkGeneratePage validation", () => {
  beforeEach(() => {
    fetchApi.mockReset();
    fetchApi.mockResolvedValue(["QA-CODE"]);
  });

  it("shows every resolver error, focuses the invalid-submit summary, and accepts blank optional limits", async () => {
    render(
      <MemoryRouter>
        <CouponBulkGeneratePage />
      </MemoryRouter>,
    );

    const prefix = screen.getByLabelText("Code Prefix") as HTMLInputElement;
    expect(prefix.maxLength).toBe(10);
    expect(screen.getByText("Prefix is optional and can be up to 10 characters.")).toBeTruthy();

    // Exercise the resolver boundary too; a real browser normally prevents this value via maxLength.
    prefix.removeAttribute("maxlength");
    fireEvent.change(prefix, { target: { value: "QA20261008FIN" } });
    fireEvent.change(screen.getByLabelText("Number of Codes"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Code Length"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Discount Value"), { target: { value: "-1" } });
    fireEvent.change(screen.getByLabelText("Minimum Purchase (points)"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("Max Uses Per Coupon"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Max Uses Per Member"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Coupons" }));

    const summary = await screen.findByRole("alert");
    expect(within(summary).getByText(/Code Prefix: Code prefix must be 10 characters or fewer/)).toBeTruthy();
    expect(within(summary).getByText(/Number of Codes: Enter a whole number/)).toBeTruthy();
    expect(within(summary).getByText(/Code Length: Code length must be a whole number/)).toBeTruthy();
    expect(screen.getByText("Enter a discount value of 0 or greater.")).toBeTruthy();
    expect(screen.getByText("Minimum purchase must be a non-negative whole number.")).toBeTruthy();
    expect(screen.getByText("Maximum uses must be a whole number of at least 1.")).toBeTruthy();
    expect(screen.getByText("Maximum uses per member must be a whole number of at least 1.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(summary));
    expect(fetchApi).not.toHaveBeenCalled();

    fireEvent.change(prefix, { target: { value: "QA26FIN" } });
    fireEvent.change(screen.getByLabelText("Number of Codes"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Code Length"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Discount Value"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Minimum Purchase (points)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Max Uses Per Coupon"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Max Uses Per Member"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Coupons" }));

    await waitFor(() => expect(fetchApi).toHaveBeenCalledOnce());
    expect(fetchApi).toHaveBeenCalledWith("/admin/coupons/generate", expect.objectContaining({ method: "POST" }));
    const payload = JSON.parse(String(fetchApi.mock.calls[0]?.[1]?.body));
    expect(payload).toMatchObject({ prefix: "QA26FIN", count: 1, discountValue: 500 });
    expect(payload.maxUses).toBeUndefined();
    expect(payload.maxUsesPerMember).toBeUndefined();
    expect(await screen.findByText("Generated Codes (1)")).toBeTruthy();
  });
});
