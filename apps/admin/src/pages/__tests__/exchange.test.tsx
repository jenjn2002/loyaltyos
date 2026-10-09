// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { ExchangeApprovalRequest } from "@/lib/exchange-approval";
import { CreditsManagementPage } from "../credits-management";

const { fetchApi } = vi.hoisted(() => ({ fetchApi: vi.fn() }));
vi.mock("@/lib/ui-text", () => ({ ui: (value: string) => value }));
vi.mock("@/lib/api-client", () => ({ fetchApi }));

const alice = { id: "admin-alice", name: "Alice Finance", email: "alice@example.com", role: "OPERATOR" };
const bob = { id: "admin-bob", name: "Bob Manager", email: "bob@example.com", role: "SUPER_ADMIN" };
const approvalRequest: ExchangeApprovalRequest = {
  id: "approval-completed",
  status: "APPROVED",
  workflowName: "Finance exchange approval",
  currentStepOrder: null,
  requestedAt: "2026-10-06T08:00:00.000Z",
  resolvedAt: "2026-10-06T10:00:00.000Z",
  resolutionComment: "Approved after receipt review",
  steps: [
    {
      id: "step-1", stepOrder: 1, name: "Finance check", approvalMode: "ANY",
      requiredApprovalCount: 1, status: "APPROVED",
      openedAt: "2026-10-06T08:00:00.000Z", completedAt: "2026-10-06T09:00:00.000Z",
      assigneesSnapshot: [
        { adminId: alice.id, name: alice.name, email: alice.email, role: alice.role },
        { adminId: "admin-chloe", name: "Chloe Reviewer", email: "chloe@example.com", role: "OPERATOR" },
      ],
      decisions: [{ id: "decision-1", decision: "APPROVE", comment: "Receipt matches the voucher", createdAt: "2026-10-06T09:00:00.000Z", approver: alice }],
    },
    {
      id: "step-2", stepOrder: 2, name: "Manager sign-off", approvalMode: "COUNT",
      requiredApprovalCount: 2, status: "APPROVED",
      openedAt: "2026-10-06T09:00:00.000Z", completedAt: "2026-10-06T10:00:00.000Z",
      assigneesSnapshot: [
        { adminId: bob.id, name: bob.name, email: bob.email, role: bob.role },
        { adminId: alice.id, name: alice.name, email: alice.email, role: alice.role },
      ],
      decisions: [
        { id: "decision-2", decision: "APPROVE", comment: "Ready for accounting", createdAt: "2026-10-06T09:30:00.000Z", approver: bob },
        { id: "decision-3", decision: "APPROVE", comment: "Confirmed final amount", createdAt: "2026-10-06T10:00:00.000Z", approver: alice },
      ],
    },
  ],
};
const completedVoucher = {
  id: "exchange-completed", documentNumber: "EX-2026-0042",
  member: { id: "member-1", email: "member@example.com", firstName: "Dana", lastName: "Member" },
  pointType: { code: "LOYAL", name: "Loyalty points", unitLabel: "points" },
  amount: 100, valueMinor: 10000, currency: "USD", payoutMechanism: "Gift card", payoutType: "NON_CASH",
  status: "COMPLETED", requestedAt: approvalRequest.requestedAt,
  approvedAt: approvalRequest.resolvedAt, approvedBy: alice.id, approvedByAdmin: alice, approvalNote: null,
  completedAt: approvalRequest.resolvedAt, completedBy: alice.id, completedByAdmin: alice,
  completionReference: `approval:${approvalRequest.id}`, completionNote: null, cancellationReason: null,
  exchangeRate: { version: 2, valueMinorPerPoint: 100 }, approvalRequest,
};
const capabilities = { "exchange.manage": true, "exchange.approve": true, "exchange.complete": true, "approval.view": true };
const clients: QueryClient[] = [];

function mockExchangeData(items: unknown[] = [], permissions: Record<string, boolean> = capabilities, currentAdminId = alice.id): void {
  fetchApi.mockImplementation(async (path: string) => {
    if (path === "/admin/me") return { id: currentAdminId, capabilities: permissions };
    if (path.includes("exchange-requests")) return { items, total: items.length || 41, totalPages: 3 };
    return [];
  });
}

function renderExchange(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter><CreditsManagementPage section="exchange" /></MemoryRouter></QueryClientProvider>);
  return client;
}

beforeEach(async () => {
  fetchApi.mockReset();
  mockExchangeData();
  await i18n.changeLanguage("en-US");
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

it("separates rates from vouchers and filters all pages on the server", async () => {
  renderExchange();
  await screen.findByText("No exchange requests.");
  expect(screen.queryByRole("button", { name: "Activate new rate version" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(fetchApi).toHaveBeenCalledWith("/admin/credits/exchange-requests?page=2&pageSize=20"));
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "PENDING" } });
  await waitFor(() => expect(fetchApi).toHaveBeenCalledWith("/admin/credits/exchange-requests?page=1&pageSize=20&status=PENDING"));
  fireEvent.click(screen.getByRole("button", { name: "Exchange rates" }));
  expect(screen.getByRole("button", { name: "Activate new rate version" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
});

it("shows a completed workflow voucher with named approvers, comments, times and its approval link", async () => {
  mockExchangeData([completedVoucher]);
  renderExchange();
  await screen.findByText("EX-2026-0042");
  const link = await screen.findByRole("link", { name: "View approval request" });
  expect(link.getAttribute("href")).toBe("/approvals?request=approval-completed");
  expect(screen.getByText(/Automatic workflow completion/)).toBeTruthy();
  expect(screen.queryByText("approval:approval-completed")).toBeNull();
  expect(screen.queryByRole("button", { name: "Mark completed" })).toBeNull();

  const summary = screen.getByText("Progress and decisions");
  fireEvent.click(summary);
  const details = summary.closest("details")!;
  expect(details.open).toBe(true);
  const history = within(details);
  expect(history.getByText("Step 1: Finance check")).toBeTruthy();
  expect(history.getByText("Step 2: Manager sign-off")).toBeTruthy();
  expect(history.getByText("One approval required")).toBeTruthy();
  expect(history.getByText("Approvals required: 2")).toBeTruthy();
  expect(history.getByText("Chloe Reviewer · chloe@example.com")).toBeTruthy();
  expect(history.getByText("Bob Manager · bob@example.com · Approved")).toBeTruthy();
  expect(history.getByText("Receipt matches the voucher")).toBeTruthy();
  expect(history.getByText("Ready for accounting")).toBeTruthy();
  expect(history.getByText("Confirmed final amount")).toBeTruthy();
  expect(history.getByText("Resolution comment: Approved after receipt review")).toBeTruthy();
  expect(history.getAllByText(/Resolved at:/)).toHaveLength(3);
  expect(history.getAllByText(/Opened at:/)).toHaveLength(2);
  expect(history.getByText(new Date("2026-10-06T09:30:00.000Z").toLocaleString("en-US"))).toBeTruthy();
  expect(details.textContent).not.toContain("admin-alice");
  expect(details.textContent).not.toContain("admin-bob");
});

it("lets exchange viewers inspect attached approval history without showing unauthorized navigation", async () => {
  mockExchangeData([completedVoucher], { "exchange.view": true });
  renderExchange();
  await screen.findByText("EX-2026-0042");
  fireEvent.click(screen.getByText("Progress and decisions"));
  expect(screen.getByText("Ready for accounting")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "View approval request" })).toBeNull();
});

it.each(["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const)("keeps the deep link for workflow status %s", async (status) => {
  mockExchangeData([{ ...completedVoucher, approvalRequest: { ...approvalRequest, status } }], { "approval.view": true });
  renderExchange();
  const link = await screen.findByRole("link", { name: status === "PENDING" ? "Review in Approval inbox" : "View approval request" });
  expect(link.getAttribute("href")).toBe("/approvals?request=approval-completed");
});

it("shows an inbox link only to a pending request's active-step assignee", async () => {
  const pending = {
    ...approvalRequest, status: "PENDING", currentStepOrder: 1,
    steps: approvalRequest.steps.map((step) => ({ ...step, status: step.stepOrder === 1 ? "PENDING" : "WAITING", decisions: [] })),
  };
  mockExchangeData([{ ...completedVoucher, status: "PENDING", approvalRequest: pending }], { "approval.inbox": true });
  renderExchange();
  const link = await screen.findByRole("link", { name: "Review in Approval inbox" });
  expect(link.getAttribute("href")).toBe("/approvals?request=approval-completed");
  expect(screen.getByText(/Current step: 1. Finance check/)).toBeTruthy();
});

it("hides the inbox link for a pending request assigned to someone else", async () => {
  const pending = {
    ...approvalRequest, status: "PENDING", currentStepOrder: 1,
    steps: approvalRequest.steps.map((step) => ({ ...step, status: step.stepOrder === 1 ? "PENDING" : "WAITING", decisions: [] })),
  };
  mockExchangeData([{ ...completedVoucher, status: "PENDING", approvalRequest: pending }], { "approval.inbox": true }, bob.id);
  renderExchange();
  await screen.findByText("EX-2026-0042");
  fireEvent.click(screen.getByText("Progress and decisions"));
  expect(screen.getByText("Step 1: Finance check")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Review in Approval inbox" })).toBeNull();
});

it("requires approval history permission to link to a resolved request", async () => {
  mockExchangeData([completedVoucher], { "approval.inbox": true });
  renderExchange();
  await screen.findByText("EX-2026-0042");
  expect(screen.queryByRole("link", { name: "View approval request" })).toBeNull();
});

it("preserves manual completion for direct approvals and displays the approving admin's name", async () => {
  mockExchangeData([{ ...completedVoucher, status: "APPROVED", approvalRequest: null, completedAt: null, completionReference: null }]);
  renderExchange();
  await screen.findByRole("button", { name: "Mark completed" });
  expect(screen.getByText(/Approved:.*Alice Finance/)).toBeTruthy();
  expect(screen.queryByText(/admin-alice/)).toBeNull();
  expect(screen.queryByText("Progress and decisions")).toBeNull();
});

it("preserves manual completion for workflow vouchers approved before automatic completion was introduced", async () => {
  mockExchangeData([{ ...completedVoucher, status: "APPROVED", completedAt: null, completionReference: null }]);
  renderExchange();
  await screen.findByRole("button", { name: "Mark completed" });
  expect(screen.getByRole("link", { name: "View approval request" })).toBeTruthy();
});

it("localizes workflow status and approval requirements in Vietnamese", async () => {
  await i18n.changeLanguage("vi-VN");
  mockExchangeData([{ ...completedVoucher, completionNote: "Automatically completed after final workflow approval. Keep this reviewer comment." }]);
  renderExchange();
  await screen.findByRole("link", { name: "Xem yêu cầu phê duyệt" });
  fireEvent.click(screen.getByText("Tiến trình và quyết định"));
  expect(screen.getByText("Cần một người phê duyệt")).toBeTruthy();
  expect(screen.getByText("Số phê duyệt cần có: 2")).toBeTruthy();
  expect(screen.getByText("Bob Manager · bob@example.com · Đã phê duyệt")).toBeTruthy();
  expect(screen.getByText("Bước 1: Finance check")).toBeTruthy();
  expect(screen.getByText(/Tự động hoàn tất sau lượt phê duyệt cuối cùng của quy trình. Keep this reviewer comment./)).toBeTruthy();
  expect(screen.queryByText(/Automatically completed after final workflow approval/)).toBeNull();
});
