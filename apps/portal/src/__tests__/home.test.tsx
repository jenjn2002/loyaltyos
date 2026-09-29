import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Home from "../pages/home";
import i18n from "../lib/i18n";

describe("Home", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en-US");
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("shows the account data warning when credits fail to load", async () => {
    sessionStorage.setItem("auth-token", "test-token");
    sessionStorage.setItem("member-id", "member-test");
    sessionStorage.setItem("program-id", "program-test");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), window.location.origin);
        if (url.pathname === "/api/v1/members/me/credits") {
          return new Response(JSON.stringify({ error: { message: "Credits unavailable" } }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }

        const responseByPath: Record<string, unknown> = {
          "/api/v1/members/me/balance": { wallets: [] },
          "/api/v1/members/me/tier": { currentTier: null, nextTier: null, pointsProgress: 0, pointsToNext: null },
          "/api/v1/rewards": { items: [] },
          "/api/v1/members/me/badges": [],
          "/api/v1/members/me/campaign-claims": { items: [], total: 0, totalPages: 1 },
          "/api/v1/members/me/check-ins": { events: [] },
        };
        return new Response(JSON.stringify({ data: responseByPath[url.pathname] ?? {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <Home />
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Session expired or account data could not be loaded/i)).toBeInTheDocument();
  });

  it("refreshes tier progress after a member claims campaign points", async () => {
    sessionStorage.setItem("auth-token", "test-token");
    sessionStorage.setItem("member-id", "member-test");
    sessionStorage.setItem("program-id", "program-test");
    let claimListReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString(), window.location.origin);
      if (url.pathname.endsWith("/claim")) return Response.json({ data: { status: "CLAIMED" } });
      const responseByPath: Record<string, unknown> = {
        "/api/v1/members/me/balance": { wallets: [] },
        "/api/v1/members/me/credits": [],
        "/api/v1/members/me/tier": { currentTier: null, nextTier: null, pointsProgress: 0, pointsToNext: null },
        "/api/v1/rewards": { items: [] },
        "/api/v1/members/me/badges": [],
        "/api/v1/members/me/check-ins": { events: [] },
      };
      if (url.pathname === "/api/v1/members/me/campaign-claims") {
        claimListReads += 1;
        responseByPath[url.pathname] = claimListReads === 1 ? {
          items: [{ id: "claim-1", pointsAwarded: 1000, status: "PENDING", claimedAt: null, createdAt: "2026-09-29T00:00:00Z", campaign: { id: "campaign-1", name: "Welcome", description: null, eventType: "registration", pointType: { id: "p", code: "P", name: "P-credit", unitLabel: "points" } } }],
          total: 1,
          totalPages: 1,
        } : { items: [], total: 0, totalPages: 0 };
      }
      return new Response(JSON.stringify({ data: responseByPath[url.pathname] ?? {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter><Home /></MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Claim points" }));

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["tier"] })));
  });
});
