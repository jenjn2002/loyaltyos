// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { DEFAULT_FAVICON_URL, useSystemBranding } from "@/lib/system-branding";
import { SystemLogoError, systemLogoFileToDataUrl } from "@/lib/system-logo";
import { LoginPage } from "@/pages/login";
import { SystemBrandingSettings } from "../system-branding-settings";
import { SystemBrandingTitle } from "../system-branding-title";

const { fetchApi } = vi.hoisted(() => ({ fetchApi: vi.fn() }));
vi.mock("@/lib/api-client", () => ({
  fetchApi,
  configuredProgramId: () => "configured-other-program",
  isAdminAuthenticated: () => false,
  adminLogin: vi.fn(),
  startMicrosoftLogin: vi.fn(),
}));
vi.mock("@/lib/system-logo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/system-logo")>("@/lib/system-logo");
  return { ...actual, systemLogoFileToDataUrl: vi.fn() };
});

let savedName: string;
let savedLogo: string | null | undefined;
const TEST_LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5FEAAAAASUVORK5CYII=";
const clients: QueryClient[] = [];

function DisplaySystemName(): JSX.Element {
  const { systemName, logoUrl } = useSystemBranding();
  return <><span data-testid="displayed-name">{systemName}</span><span data-testid="displayed-logo">{logoUrl ?? "none"}</span></>;
}

function renderEditor(canManage = true): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <SystemBrandingTitle />
        <DisplaySystemName />
        <SystemBrandingSettings canManage={canManage} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(async () => {
  savedName = "Team Rewards";
  savedLogo = undefined;
  vi.mocked(systemLogoFileToDataUrl).mockReset().mockResolvedValue(TEST_LOGO);
  fetchApi.mockReset();
  fetchApi.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === "/admin/settings/branding" && options?.method === "PUT") {
      const update = JSON.parse(String(options.body)) as { systemName: string; logoUrl?: string | null };
      savedName = update.systemName;
      if ("logoUrl" in update) savedLogo = update.logoUrl;
    }
    return { systemName: savedName, ...(savedLogo !== undefined ? { logoUrl: savedLogo } : {}) };
  });
  await i18n.changeLanguage("en-US");
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  document.title = "LoyaltyOS Admin";
  document.querySelector("link[data-system-favicon]")?.remove();
});

describe("admin system branding", () => {
  it("keeps view-only settings disabled and prevents a forged form submit from saving", async () => {
    renderEditor(false);
    const input = await screen.findByDisplayValue("Team Rewards") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save branding" })).toBeNull();
    const logoInput = screen.getByLabelText("System logo") as HTMLInputElement;
    expect(logoInput.disabled).toBe(true);
    fireEvent.change(logoInput, { target: { files: [new File(["image"], "logo.png", { type: "image/png" })] } });
    fireEvent.submit(input.closest("form")!);
    expect(systemLogoFileToDataUrl).not.toHaveBeenCalled();
    expect(fetchApi.mock.calls.some(([, options]) => options?.method === "PUT")).toBe(false);
  });

  it("trims a saved name and immediately updates authenticated display and browser title", async () => {
    const client = renderEditor();
    const input = await screen.findByDisplayValue("Team Rewards");
    client.setQueryData(["system-branding", "public", "configured-other-program"], { systemName: "Another program" });
    fireEvent.change(input, { target: { value: "  Acme Recognition  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    await screen.findByText("Branding saved.");
    expect(fetchApi).toHaveBeenCalledWith("/admin/settings/branding", {
      method: "PUT", body: JSON.stringify({ systemName: "Acme Recognition" }),
    });
    expect(screen.getByTestId("displayed-name").textContent).toBe("Acme Recognition");
    expect(document.title).toBe("Acme Recognition Admin");
    expect(screen.getByTestId("displayed-logo").textContent).toBe("none");
    expect(client.getQueryData(["system-branding", "public", "configured-other-program"])).toEqual({ systemName: "Another program" });
    expect(client.getQueryState(["system-branding", "public", "configured-other-program"])?.isInvalidated).toBe(true);
    expect(fetchApi).toHaveBeenCalledWith("/branding");
    expect(fetchApi.mock.calls.some(([path]) => String(path).startsWith("/auth/branding"))).toBe(false);
  });

  it("rejects blank or oversized names before sending an update", async () => {
    renderEditor();
    const input = await screen.findByDisplayValue("Team Rewards");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a system name.");
    fireEvent.change(input, { target: { value: "A".repeat(81) } });
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    expect(screen.getByRole("alert").textContent).toBe("System name must be 80 characters or fewer.");
    expect(fetchApi.mock.calls.some(([, options]) => options?.method === "PUT")).toBe(false);
  });

  it("previews and saves an uploaded logo, updates the favicon, and restores the default after removal", async () => {
    renderEditor();
    await screen.findByDisplayValue("Team Rewards");
    const favicon = document.querySelector<HTMLLinkElement>("link[data-system-favicon]")!;
    expect(favicon.getAttribute("href")).toBe(DEFAULT_FAVICON_URL);
    fireEvent.change(screen.getByLabelText("System logo"), {
      target: { files: [new File(["image"], "logo.png", { type: "image/png" })] },
    });
    const preview = await screen.findByRole("img", { name: "System logo preview" });
    expect(preview.getAttribute("src")).toBe(TEST_LOGO);
    expect(favicon.getAttribute("href")).toBe(DEFAULT_FAVICON_URL);
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    await screen.findByText("Branding saved.");
    expect(fetchApi).toHaveBeenCalledWith("/admin/settings/branding", {
      method: "PUT", body: JSON.stringify({ systemName: "Team Rewards", logoUrl: TEST_LOGO }),
    });
    expect(favicon.getAttribute("href")).toBe(TEST_LOGO);
    expect(favicon.type).toBe("image/png");
    expect(screen.getByTestId("displayed-logo").textContent).toBe(TEST_LOGO);
    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
    expect(screen.queryByRole("img", { name: "System logo preview" })).toBeNull();
    expect(favicon.getAttribute("href")).toBe(TEST_LOGO);
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    await screen.findByText("Branding saved.");
    expect(fetchApi).toHaveBeenCalledWith("/admin/settings/branding", {
      method: "PUT", body: JSON.stringify({ systemName: "Team Rewards", logoUrl: null }),
    });
    expect(favicon.getAttribute("href")).toBe(DEFAULT_FAVICON_URL);
    expect(favicon.type).toBe("image/svg+xml");
  });

  it("preserves an existing logo when only the system name changes", async () => {
    savedLogo = TEST_LOGO;
    renderEditor();
    fireEvent.change(await screen.findByDisplayValue("Team Rewards"), { target: { value: "New name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    await screen.findByText("Branding saved.");
    expect(fetchApi).toHaveBeenCalledWith("/admin/settings/branding", {
      method: "PUT", body: JSON.stringify({ systemName: "New name" }),
    });
    expect(document.querySelector("link[data-system-favicon]")?.getAttribute("href")).toBe(TEST_LOGO);
  });

  it("blocks form submission while an image is being processed", async () => {
    let resolveLogo: (logo: string) => void = () => undefined;
    vi.mocked(systemLogoFileToDataUrl).mockImplementation(() => new Promise((resolve) => { resolveLogo = resolve; }));
    renderEditor();
    const input = await screen.findByDisplayValue("Team Rewards");
    fireEvent.change(screen.getByLabelText("System logo"), {
      target: { files: [new File(["image"], "logo.png", { type: "image/png" })] },
    });
    expect((screen.getByRole("button", { name: "Save branding" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(input.closest("form")!);
    expect(fetchApi.mock.calls.some(([, options]) => options?.method === "PUT")).toBe(false);
    await act(async () => resolveLogo(TEST_LOGO));
    expect((screen.getByRole("button", { name: "Save branding" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a localized image validation error and preserves the saved logo", async () => {
    savedLogo = TEST_LOGO;
    vi.mocked(systemLogoFileToDataUrl).mockRejectedValue(new SystemLogoError("logoInvalidType"));
    renderEditor();
    await screen.findByDisplayValue("Team Rewards");
    fireEvent.change(screen.getByLabelText("System logo"), {
      target: { files: [new File(["svg"], "logo.svg", { type: "image/svg+xml" })] },
    });
    await screen.findByText("Choose a PNG, JPEG, WebP or GIF image.");
    expect(screen.getByRole("img", { name: "System logo preview" }).getAttribute("src")).toBe(TEST_LOGO);
    expect(fetchApi.mock.calls.some(([, options]) => options?.method === "PUT")).toBe(false);
  });

  it("disables repeated saves while pending and keeps the existing name after a server failure", async () => {
    let rejectSave: (reason: Error) => void = () => undefined;
    fetchApi.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/admin/settings/branding" && options?.method === "PUT") {
        return new Promise((_resolve, reject) => { rejectSave = reject; });
      }
      return Promise.resolve({ systemName: savedName });
    });
    renderEditor();
    const input = await screen.findByDisplayValue("Team Rewards") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));
    const pendingButton = await screen.findByRole("button", { name: "Saving…" }) as HTMLButtonElement;
    expect(pendingButton.disabled).toBe(true);
    expect(input.disabled).toBe(true);
    rejectSave(new Error("Settings service unavailable"));
    await screen.findByText("Unable to save the system branding. Settings service unavailable");
    expect(screen.getByTestId("displayed-name").textContent).toBe("Team Rewards");
    expect(document.title).toBe("Team Rewards Admin");
  });

  it("shows Vietnamese labels and validation", async () => {
    await i18n.changeLanguage("vi-VN");
    renderEditor();
    const input = await screen.findByLabelText("Tên hệ thống");
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu tên và logo" }));
    expect(screen.getByRole("alert").textContent).toBe("Nhập tên hệ thống.");
  });

  it("loads the configured public program for login and renders special characters as text", async () => {
    savedName = "<script>alert(1)</script> & Rewards";
    savedLogo = TEST_LOGO;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    const { container } = render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter><LoginPage /></MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    );
    await screen.findByText(`${savedName} Admin`);
    expect(fetchApi).toHaveBeenCalledWith("/auth/branding?programId=configured-other-program");
    expect(fetchApi).not.toHaveBeenCalledWith("/branding");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(TEST_LOGO);
    expect(document.querySelector("link[data-system-favicon]")?.getAttribute("href")).toBe(TEST_LOGO);
    expect(document.title).toBe(`${savedName} Admin`);
  });

  it("falls back to LoyaltyOS when public branding is unavailable", async () => {
    fetchApi.mockRejectedValue(new Error("Unavailable"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter><LoginPage /></MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("LoyaltyOS Admin")).toBeTruthy();
    expect(document.title).toBe("LoyaltyOS Admin");
  });
});
