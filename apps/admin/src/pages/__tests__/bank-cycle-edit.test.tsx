// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreditsManagementPage } from "../credits-management";

const { fetchApi } = vi.hoisted(() => ({ fetchApi: vi.fn() }));
vi.mock("@/lib/ui-text", () => ({ ui: (value: string) => value }));
vi.mock("@/lib/api-client", () => ({ fetchApi }));
const cycle = { id: "cycle-test", pointTypeId: "pt", startsAt: "2020-01-01T10:00:00.123Z", endsAt: "2099-01-01T10:00:00.000Z", status: "OPEN", opening: 100, allocated: 0, closing: 0, clearBankOnClose: false, pointType: { code: "R", name: "R-credit", unitLabel: "points" } };
let client: QueryClient;
beforeEach(() => {
  fetchApi.mockReset();
  fetchApi.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === "/admin/me") return { id: "admin", capabilities: { "bank.view": true, "bank.manage": true, "point_type.view": true } };
    if (path === "/admin/credits/bank/cycles" && !options) return [cycle];
    if (path === "/admin/credits/bank/cycles/cycle-test" && options?.method === "PATCH") return cycle;
    return [];
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><CreditsManagementPage section="banks" /></MemoryRouter></QueryClientProvider>);
});
afterEach(() => { cleanup(); client.clear(); });
async function openForm() {
  fireEvent.click(await screen.findByRole("button", { name: "Edit cycle times" }));
  const start = document.getElementById("edit-cycle-start-cycle-test") as HTMLInputElement;
  const end = document.getElementById("edit-cycle-end-cycle-test") as HTMLInputElement;
  return { start, end, form: start.closest(".grid") as HTMLElement };
}
it("shows an inline error when nothing changed", async () => {
  const { form } = await openForm();
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  expect((await within(form).findByRole("alert")).textContent).toBe("No cycle changes were made.");
  expect(fetchApi).not.toHaveBeenCalledWith("/admin/credits/bank/cycles/cycle-test", expect.anything());
});
it("shows past-time validation beside the edited cycle", async () => {
  const { end, form } = await openForm();
  fireEvent.change(end, { target: { value: "2021-01-01T10:00:00" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  expect((await within(form).findByRole("alert")).textContent).toBe("Changed cycle times must be in the future.");
});
it("shows API errors inside the form", async () => {
  const { end, form } = await openForm();
  fetchApi.mockImplementationOnce(async () => { throw new Error("Point bank cycle dates invalid"); });
  fireEvent.change(end, { target: { value: "2098-01-01T10:00:00" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  expect((await within(form).findByRole("alert")).textContent).toContain("Changed cycle times must be in the future and the end must be after the start.");
});
it("sends only the changed end time and displays success next to the cycle", async () => {
  const { end, form } = await openForm();
  fireEvent.change(end, { target: { value: "2098-01-01T10:00:00" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fetchApi).toHaveBeenCalledWith("/admin/credits/bank/cycles/cycle-test", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ endsAt: new Date("2098-01-01T10:00:00").toISOString() }) })));
  expect(await screen.findByText("Bank cycle times updated.")).toBeTruthy();
});

it("saves the clear-bank setting without requiring a time change", async () => {
  const { form } = await openForm();
  const checkbox = within(form).getByRole("checkbox", { name: /Clear bank when cycle closes/ }) as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  fireEvent.click(checkbox);
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fetchApi).toHaveBeenCalledWith("/admin/credits/bank/cycles/cycle-test", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ clearBankOnClose: true }) })));
  expect(await screen.findByText("Bank cycle updated.")).toBeTruthy();
});
