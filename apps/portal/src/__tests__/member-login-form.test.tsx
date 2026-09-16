import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemberLoginForm } from "../components/member-login-form";
import i18n from "../lib/i18n";

function renderForm(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemberLoginForm />
    </QueryClientProvider>,
  );
}

function authMethodsResponse(microsoft: boolean): Response {
  return new Response(JSON.stringify({ data: { password: true, microsoft } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("MemberLoginForm", () => {
  beforeEach(() => {
    void i18n.changeLanguage("en-US");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps Microsoft sign-in hidden when the provider is disabled", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(authMethodsResponse(false)));
    renderForm();

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Microsoft 365/i })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDefined();
  });

  it("renders Microsoft sign-in only when the public auth method enables it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(authMethodsResponse(true)));
    renderForm();

    expect(await screen.findByRole("button", { name: /Microsoft 365/i })).toBeDefined();
  });
});
