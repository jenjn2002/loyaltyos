import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import i18n from "../lib/i18n";

async function renderApp(initialRoute = "/") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });

  const result = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // App restores Microsoft sessions asynchronously before rendering routes.
  await waitFor(() => expect(result.container.firstElementChild?.textContent?.trim()).not.toBe(""));
  return result;
}

function login() {
  sessionStorage.setItem("auth-token", "test-token");
  sessionStorage.setItem("member-id", "mem_001");
  sessionStorage.setItem("program-id", "prog_001");
}

describe("Portal", () => {
  beforeEach(() => {
    sessionStorage.clear();
    void i18n.changeLanguage("en-US");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders home page with bottom navigation", async () => {
    await renderApp();
    expect(screen.getByRole("heading", { name: "Home" })).toBeDefined();
    expect(screen.getByRole("navigation")).toBeDefined();
  });

  it("shows sign in prompt when not authenticated on home", async () => {
    await renderApp();
    const elements = screen.getAllByText("Sign In");
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it("has 8 nav links when authenticated", async () => {
    login();
    await renderApp();
    const nav = screen.getByRole("navigation");
    const links = nav.querySelectorAll("a");
    expect(links.length).toBe(8);
  });

  it("profile page renders login form when not authenticated", async () => {
    await renderApp("/profile");
    expect(screen.getByLabelText("Username")).toBeDefined();
    expect(screen.getByLabelText("Password")).toBeDefined();
    expect(screen.getByRole("button", { name: /^Sign in$/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Microsoft 365/i })).toBeNull();
  });

  it("profile page shows sign out when authenticated", async () => {
    login();
    await renderApp("/profile");
    expect(screen.getByText(/Sign Out/i)).toBeDefined();
  });

  it("theme toggle buttons exist on profile page", async () => {
    await renderApp("/profile");
    expect(screen.getByRole("radio", { name: /Light/i })).toBeDefined();
    expect(screen.getByRole("radio", { name: /Dark/i })).toBeDefined();
  });

  it("language selector changes value", async () => {
    await renderApp("/profile");
    const select = screen.getByRole("combobox");
    await userEvent.selectOptions(select, "vi-VN");
    expect(screen.getByRole("combobox", { name: /Ngôn ngữ/ })).toBeDefined();
  });

  it("rewards page redirects to profile when not authenticated", async () => {
    await renderApp("/rewards");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeDefined();
  });

  it("badges page redirects to profile when not authenticated", async () => {
    await renderApp("/badges");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeDefined();
  });

  it("transactions page redirects to profile when not authenticated", async () => {
    await renderApp("/transactions");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeDefined();
  });

  it("notifications page redirects to profile when not authenticated", async () => {
    await renderApp("/notifications");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeDefined();
  });

  it("credits page redirects to profile when not authenticated", async () => {
    await renderApp("/credits");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeDefined();
  });

  it("credits page shows an immediate loading state while wallets are requested", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    login();
    await renderApp("/credits");
    expect(screen.getByText("Loading credit wallets…")).toBeDefined();
  });

  it("handles unknown routes with redirect to home", async () => {
    await renderApp("/nonexistent");
    expect(await screen.findByRole("heading", { name: "Home" })).toBeDefined();
  });

  it("home page hides sign in prompt when authenticated", async () => {
    login();
    await renderApp();
    const signInElements = screen.queryAllByText("Sign In");
    expect(signInElements.length).toBe(0);
  });

  it("logout clears session", async () => {
    login();
    await renderApp("/profile");
    const logoutBtn = screen.getByText(/Sign Out/i);
    logoutBtn.click();
    await waitFor(() => expect(sessionStorage.getItem("auth-token")).toBeNull());
  });
});
