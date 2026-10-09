import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import { clearSession, setSession } from "../lib/auth";
import i18n from "../lib/i18n";
import { DEFAULT_FAVICON_URL, normalizeSystemLogo, useProgramBranding, useSystemBranding } from "../lib/system-branding";

const clients: QueryClient[] = [];
const logoUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=";

function queryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

describe("Portal system branding", () => {
  beforeEach(async () => {
    sessionStorage.clear();
    document.title = "";
    document.querySelectorAll("link[data-system-favicon]").forEach((icon) => icon.remove());
    await i18n.changeLanguage("en-US");
  });

  afterEach(() => {
    for (const client of clients.splice(0)) client.clear();
    focusManager.setFocused(undefined);
    vi.unstubAllGlobals();
  });

  it.each([{}, { systemName: null }, { systemName: "   " }])(
    "keeps the default for absent or blank names: %j",
    async (data) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data })));
      const { wrapper, client } = queryWrapper();
      const { result } = renderHook(useSystemBranding, { wrapper });
      await waitFor(() => expect(client.isFetching()).toBe(0));
      expect(result.current).toBe("LoyaltyOS");
    },
  );

  it("keeps the default when branding is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unavailable")));
    const { wrapper, client } = queryWrapper();
    const { result } = renderHook(useSystemBranding, { wrapper });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(result.current).toBe("LoyaltyOS");
  });

  it("shares the logo response with the existing name accessor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: { systemName: "Acme Club", logoUrl } }));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = queryWrapper();
    const { result } = renderHook(() => ({ name: useSystemBranding(), branding: useProgramBranding() }), { wrapper });
    await waitFor(() => expect(result.current.branding).toEqual({ systemName: "Acme Club", logoUrl }));
    expect(result.current.name).toBe("Acme Club");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:text/html;base64,PGh0bWwvPg==",
    "https://example.com/logo.svg",
    "https://user:password@example.com/logo.png",
    "not-an-image",
  ])("ignores unsupported logo sources: %s", (value) => {
    expect(normalizeSystemLogo(value)).toBeNull();
  });

  it("loads the configured public program and refreshes its name on focus", async () => {
    sessionStorage.setItem("program-id", "prog_public");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: { systemName: "Acme Rewards" } }))
      .mockResolvedValueOnce(Response.json({ data: { systemName: "Acme Club" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = queryWrapper();
    const { result } = renderHook(useSystemBranding, { wrapper });
    await waitFor(() => expect(result.current).toBe("Acme Rewards"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/branding?programId=prog_public",
      expect.objectContaining({ headers: expect.objectContaining({ "X-Program-Id": "prog_public" }) }),
    );

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(result.current).toBe("Acme Club"));
  });

  it("clears the displayed name as authentication and programs change", async () => {
    let resolveMemberBranding: ((response: Response) => void) | undefined;
    let resolvePublicBranding: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: { systemName: "Public Club" } }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveMemberBranding = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolvePublicBranding = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = queryWrapper();
    const { result } = renderHook(useSystemBranding, { wrapper });
    await waitFor(() => expect(result.current).toBe("Public Club"));

    act(() => setSession({ token: "session_2", memberId: "member_2", programId: "prog_2" }));
    expect(result.current).toBe("LoyaltyOS");
    await waitFor(() => expect(resolveMemberBranding).toBeDefined());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/branding", expect.objectContaining({
      headers: expect.objectContaining({ "X-Program-Id": "prog_2", Authorization: "Bearer session_2" }),
    }));
    await act(async () => resolveMemberBranding?.(Response.json({ data: { systemName: "Member Club" } })));
    await waitFor(() => expect(result.current).toBe("Member Club"));

    act(clearSession);
    expect(result.current).toBe("LoyaltyOS");
    await waitFor(() => expect(resolvePublicBranding).toBeDefined());
    await act(async () => resolvePublicBranding?.(Response.json({ data: { systemName: "New Public Club" } })));
    await waitFor(() => expect(result.current).toBe("New Public Club"));
  });

  it("updates the browser title and public login display without translating the name", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/auth/me")) return Response.json({ error: { message: "Sign in" } }, { status: 401 });
      if (url.includes("/auth/branding")) return Response.json({ data: { systemName: "Acme & Co" } });
      return Response.json({ data: { password: true, microsoft: false } });
    }));
    const { wrapper, client } = queryWrapper();
    render(<MemoryRouter initialEntries={["/profile"]}><App /></MemoryRouter>, { wrapper });
    expect(document.title).toBe("LoyaltyOS — Rewards Portal");
    await waitFor(() => expect(document.title).toBe("Acme & Co — Rewards Portal"));
    expect(await screen.findByRole("link", { name: "Acme & Co" })).toBeInTheDocument();
    expect(screen.getByText("Acme & Co", { selector: "p" })).toBeInTheDocument();

    act(() => client.setQueryData(["system-branding", false, "prog_dev", null], { systemName: "Acme Club" }));
    await waitFor(() => expect(document.title).toBe("Acme Club — Rewards Portal"));
    await act(async () => { await i18n.changeLanguage("vi-VN"); });
    expect(screen.getByText("Acme Club", { selector: "p" })).toBeInTheDocument();
    expect(document.title).toBe("Acme Club — Rewards Portal");
  });

  it("shows the logo in the portal and login card and restores the default favicon when cleared", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/auth/me")) return Response.json({ error: { message: "Sign in" } }, { status: 401 });
      if (url.includes("/auth/branding")) return Response.json({ data: { systemName: "Acme Club", logoUrl } });
      return Response.json({ data: { password: true, microsoft: false } });
    }));
    const { wrapper, client } = queryWrapper();
    const { container } = render(<MemoryRouter initialEntries={["/profile"]}><App /></MemoryRouter>, { wrapper });
    await waitFor(() => expect(document.title).toBe("Acme Club — Rewards Portal"));
    const header = screen.getByRole("link", { name: "Acme Club" });
    expect(header.querySelector("img")).toHaveAttribute("src", logoUrl);
    expect(container.querySelectorAll(`img[src="${logoUrl}"]`)).toHaveLength(2);
    const favicon = document.querySelector<HTMLLinkElement>("link[data-system-favicon]");
    expect(favicon).toHaveAttribute("href", logoUrl);
    expect(favicon).toHaveAttribute("type", "image/png");

    act(() => client.setQueryData(["system-branding", false, "prog_dev", null], { systemName: "Acme Club", logoUrl: null }));
    await waitFor(() => expect(favicon).toHaveAttribute("href", DEFAULT_FAVICON_URL));
    expect(favicon).toHaveAttribute("type", "image/svg+xml");
    expect(header.querySelector("img")).toBeNull();
    expect(container.querySelectorAll(`img[src="${logoUrl}"]`)).toHaveLength(0);
    expect(document.querySelectorAll("link[data-system-favicon]")).toHaveLength(1);
  });
});
