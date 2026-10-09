// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeveloperDocument, developerCurlTemplate, normalizeApiBaseUrl } from "../developer-document";
import type { ApiEndpoint } from "@/content/developer-api-types";

vi.mock("@/content/developer-api-guide", () => ({
  getDeveloperApiGuide: (locale: string) => [{
    id: "access", title: locale === "vi" ? "Lấy quyền API" : "Get API access", purpose: "Use the documented credentials.", steps: ["Ask the deployment owner."], notes: [],
    codeSamples: [{ title: "Configure API base", language: "sh", code: "API_BASE_URL='{{API_BASE_URL}}'" }],
  }],
}));

const { endpoints } = vi.hoisted(() => ({ endpoints: [
  {
    id: "admin-wallet", method: "POST", path: "/api/v1/admin/wallets/:id/adjust", group: "Wallets", summary: "Adjust a wallet", description: "Adjust an authorized wallet.", source: { file: "apps/api/src/routes/admin/wallets.ts", line: 10 },
    access: { mode: "admin", credentials: ["SERVER X-API-Key or admin cookie"], capabilities: ["wallet.adjust"], notes: ["Requires a server-scoped key."] },
    request: { params: [{ name: "id", type: "string", required: true }], query: [], headers: [], body: { type: "object", required: true, fields: [{ name: "reason", type: "string", required: true, constraints: ["min length: 1"] }] } }, responses: [], notes: [],
  },
  {
    id: "member-wallet", method: "GET", path: "/api/v1/member/wallets", group: "Members", summary: "List member wallets", description: "Member wallets.", source: { file: "apps/api/src/routes/member/wallets.ts", line: 10 },
    access: { mode: "member", credentials: ["Bearer member session"], capabilities: [], notes: [] }, request: { params: [], query: [], headers: [], body: null }, responses: [], notes: [],
  },
  {
    id: "ready", method: "GET", path: "/readyz", group: "Infrastructure", summary: "Readiness probe", description: "Backend readiness.", backendOnly: true, source: { file: "apps/api/src/app.ts", line: 10 },
    access: { mode: "infrastructure", credentials: [], capabilities: [], notes: [] }, request: { params: [], query: [], headers: [], body: null }, responses: [], notes: [],
  },
  {
    id: "admin-approvals", method: "GET", path: "/api/v1/admin/approvals", group: "Admin · Approvals", summary: "List approvals", description: "Approval inbox.", source: { file: "apps/api/src/routes/admin/approvals.ts", line: 10 },
    access: { mode: "admin", credentials: ["Cookie: loyaltyos_admin_session=<admin-session>"], capabilities: ["approval.view"], notes: [] }, request: { params: [], query: [], headers: [], body: null }, responses: [], notes: [],
  },
  {
    id: "server-key-only", method: "GET", path: "/api/v1/admin/server-key-only", group: "Admin · Settings", summary: "Server key endpoint", description: "Requires a server key.", source: { file: "apps/api/src/routes/admin/settings.ts", line: 10 },
    access: { mode: "admin", credentials: ["X-API-Key: <server-key>"], capabilities: [], notes: [] }, request: { params: [], query: [], headers: [], body: null }, responses: [], notes: [],
  },
  {
    id: "authenticated-server-key", method: "POST", path: "/api/v1/admin/issue", group: "Admin · Issuance", summary: "Issue points", description: "Accepts a member session or server key.", source: { file: "apps/api/src/routes/admin/issuance.ts", line: 10 },
    access: { mode: "authenticated", credentials: ["Authorization: Bearer <member-session>", "X-API-Key: <server-key>"], capabilities: [], notes: [] }, request: { params: [], query: [], headers: [], body: null }, responses: [], notes: [],
  },
] }));

vi.mock("@/content/developer-api-reference.json", () => ({ default: { generatedAt: "2026-10-07T00:00:00.000Z", endpointCount: endpoints.length, endpoints } }));

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  vi.spyOn(window, "print").mockImplementation(() => undefined);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("developer documentation", () => {
  it("intersects search, method and access filters while searching nested request fields", () => {
    render(<DeveloperDocument isEnglish systemName="Sandboxe" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search the API reference" }), { target: { value: "reason" } });
    expect(screen.getByRole("heading", { name: "/api/v1/admin/wallets/:id/adjust" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "/api/v1/member/wallets" })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: /HTTP method/ }), { target: { value: "GET" } });
    expect(screen.getByText("No matching endpoints. Change the search or filters.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Accepted credentials" }), { target: { value: "member" } });
    expect(screen.getByRole("heading", { name: "/api/v1/member/wallets" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "/api/v1/admin/wallets/:id/adjust" })).toBeNull();
  });

  it("copies placeholder cURL with the edited API port and does not issue an API request", async () => {
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue(new Response("{}"));
    render(<DeveloperDocument isEnglish systemName="Sandboxe" />);
    fireEvent.change(screen.getByRole("textbox", { name: "API base URL" }), { target: { value: "https://api.example.com:8443/api/v1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Search the API reference" }), { target: { value: "wallet.adjust" } });
    fireEvent.click(screen.getByRole("button", { name: "View request and response details" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy: cURL request template" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const code = writeText.mock.calls[0]![0] as string;
    expect(code).toContain("https://api.example.com:8443/api/v1/admin/wallets/{{id}}/adjust");
    expect(code).toContain("X-API-Key: {{SERVER_API_KEY}}");
    expect(code).toContain('"reason": "{{reason}}"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("expands full details for all filtered endpoints before PDF printing", () => {
    render(<DeveloperDocument isEnglish systemName="Sandboxe" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search the API reference" }), { target: { value: "wallet.adjust" } });
    expect(document.querySelectorAll(".developer-endpoint-details")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    expect(window.print).toHaveBeenCalledOnce();
    expect(document.querySelectorAll(".developer-endpoint-details")).toHaveLength(1);
    expect(screen.getByText("min length: 1")).toBeTruthy();
    expect(document.querySelector("#developer-api-member-wallet")).toBeNull();
    fireEvent(window, new Event("afterprint"));
    expect(document.querySelectorAll(".developer-endpoint-details")).toHaveLength(0);
  });

  it("uses a separate backend placeholder for infrastructure routes and switches guide language", () => {
    const { rerender } = render(<DeveloperDocument isEnglish systemName="Sandboxe" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search the API reference" }), { target: { value: "readyz" } });
    fireEvent.click(screen.getByRole("button", { name: "View request and response details" }));
    expect(screen.getByText("curl --request GET '{{API_BACKEND_ORIGIN}}/readyz'")).toBeTruthy();
    rerender(<DeveloperDocument isEnglish={false} systemName="Sandboxe" />);
    expect(screen.getByRole("heading", { name: "1. Lấy quyền API" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Danh mục API" })).toBeTruthy();
  });

  it("validates base URLs and keeps member bearer credentials distinct from admin credentials", () => {
    expect(normalizeApiBaseUrl("http://localhost:3002/api/v1/")).toBe("http://localhost:3002/api/v1");
    expect(normalizeApiBaseUrl("https://user:secret@example.com/api/v1")).toBeNull();
    expect(normalizeApiBaseUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeApiBaseUrl("https://example.com/api/v1?key=secret")).toBeNull();
    expect(developerCurlTemplate(endpoints[1] as ApiEndpoint, "https://api.example.com/api/v1")).toContain("Authorization: Bearer {{MEMBER_SESSION_TOKEN}}");
    expect(developerCurlTemplate(endpoints[1] as ApiEndpoint, "https://api.example.com/api/v1")).not.toContain("X-API-Key");
  });

  it("labels and filters endpoints from their accepted credentials instead of a mode-only label", () => {
    render(<DeveloperDocument isEnglish systemName="Sandboxe" />);
    expect(screen.getAllByText("Admin session or SERVER API key").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Admin session").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SERVER API key").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Member session").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Member session or SERVER API key").length).toBeGreaterThan(0);

    const access = screen.getByRole("combobox", { name: "Accepted credentials" });
    const memberOption = screen.getByRole("option", { name: "Member session" }) as HTMLOptionElement;
    fireEvent.change(access, { target: { value: memberOption.value } });
    expect(screen.getByRole("heading", { name: "/api/v1/member/wallets" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "/api/v1/admin/wallets/:id/adjust" })).toBeNull();

    const authenticatedEndpoint = endpoints.find((endpoint) => endpoint.id === "authenticated-server-key") as ApiEndpoint;
    expect(developerCurlTemplate(authenticatedEndpoint, "https://api.example.com/api/v1")).toContain("X-API-Key: {{SERVER_API_KEY}}");
  });

  it("provides contextual help for API and backend origin controls", () => {
    render(<DeveloperDocument isEnglish systemName="Sandboxe" />);
    expect(screen.getByRole("textbox", { name: "API base URL" }).getAttribute("data-help")).toContain("changes code examples only");
    expect(screen.getByRole("textbox", { name: "Direct backend origin (infrastructure routes)" }).getAttribute("data-help")).toContain("without /api/v1");
  });

  it("searches translated Vietnamese groups while preserving English filter values and search terms", () => {
    render(<DeveloperDocument isEnglish={false} systemName="Sandboxe" />);
    const search = screen.getByRole("textbox", { name: "Tìm trong danh mục API" });
    fireEvent.change(search, { target: { value: "thành viên" } });
    expect(screen.getByRole("heading", { name: "/api/v1/member/wallets" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "/api/v1/admin/approvals" })).toBeNull();
    fireEvent.change(search, { target: { value: "phe duyet" } });
    expect(screen.getByRole("heading", { name: "/api/v1/admin/approvals" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "/api/v1/member/wallets" })).toBeNull();
    const option = screen.getByRole("option", { name: "Admin · Phê duyệt" }) as HTMLOptionElement;
    expect(option.value).toBe("Admin · Approvals");
    fireEvent.change(search, { target: { value: "Approvals" } });
    expect(screen.getByRole("heading", { name: "/api/v1/admin/approvals" })).toBeTruthy();
  });
});
