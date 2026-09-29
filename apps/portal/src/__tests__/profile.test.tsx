import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../lib/i18n";
import Profile from "../pages/profile";

describe("Customer profile", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en-US");
    sessionStorage.setItem("auth-token", "test-token");
    sessionStorage.setItem("member-id", "member-test");
    sessionStorage.setItem("program-id", "program-test");
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("shows department in the read-only member profile", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString(), window.location.origin);
      const data = url.pathname.endsWith("/members/me")
        ? { id: "member-test", email: "member@example.test", phone: null, firstName: "Test", lastName: "Member", department: "Engineering", metadata: {}, memberFields: [], joinedAt: "2026-01-01T00:00:00Z" }
        : [];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter><Profile /></MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Engineering")).toBeInTheDocument();
  });
});
