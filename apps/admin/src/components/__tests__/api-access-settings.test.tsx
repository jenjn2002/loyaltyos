// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { ApiAccessSettings } from "../api-access-settings";

const { fetchApi } = vi.hoisted(() => ({ fetchApi: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ fetchApi }));

const ONE_TIME_SECRET = "test-only-one-time-secret";
const initialKey = {
  id: "key-existing",
  name: "Browser integration",
  scope: "CLIENT",
  isActive: true,
  createdAt: "2026-09-01T00:00:00.000Z",
  expiresAt: null,
  lastUsedAt: null,
};
const fullCapabilities = { "settings.view": true, "api_key.view": true, "api_key.manage": true };
let profile: { id: string; capabilities: Record<string, boolean> };
let serverKeys: (typeof initialKey)[];
let createError: Error | null;
let listError: Error | null;
let revokeError: Error | null;
let createdKeyCount: number;
const clients: QueryClient[] = [];
const writeText = vi.fn();

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ApiAccessSettings />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

function postCalls() {
  return fetchApi.mock.calls.filter(
    ([path, options]) => path === "/admin/settings/api-keys" && options?.method === "POST",
  );
}

async function createKey(name = "  Backend integration  ") {
  fireEvent.change(await screen.findByLabelText("Key name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
  return screen.findByLabelText("New API key (shown once)") as Promise<HTMLInputElement>;
}

beforeEach(async () => {
  profile = { id: "admin-owner", capabilities: fullCapabilities };
  serverKeys = [{ ...initialKey }];
  createError = null;
  listError = null;
  revokeError = null;
  createdKeyCount = 0;
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  fetchApi.mockReset();
  fetchApi.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === "/admin/me") return profile;
    if (path === "/admin/settings/api-access")
      return { programId: "program-from-session", environment: "staging", apiBasePath: "/api/v1" };
    if (path === "/admin/settings/api-keys" && options?.method === "POST") {
      if (createError) throw createError;
      const input = JSON.parse(String(options.body)) as {
        name: string;
        scope: string;
        expiresInDays: number | null;
      };
      const key = {
        ...initialKey,
        id: `key-new-${++createdKeyCount}`,
        name: input.name,
        scope: input.scope,
      };
      serverKeys = [...serverKeys, key];
      return { key, secret: ONE_TIME_SECRET };
    }
    if (path === "/admin/settings/api-keys") {
      if (listError) throw listError;
      return { keys: serverKeys.map((key) => ({ ...key })) };
    }
    if (options?.method === "DELETE") {
      if (revokeError) throw revokeError;
      const id = path.split("/").pop();
      serverKeys = serverKeys.map((key) => (key.id === id ? { ...key, isActive: false } : key));
      return { key: serverKeys.find((key) => key.id === id) };
    }
    throw new Error(`Unexpected test endpoint: ${path}`);
  });
  await i18n.changeLanguage("en-US");
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

describe("API access settings", () => {
  it("shows the session's read-only Program ID and current-origin URL without fetching keys when ungranted", async () => {
    profile.capabilities = { "settings.view": true };
    renderSettings();
    const programInput = (await screen.findByDisplayValue(
      "program-from-session",
    )) as HTMLInputElement;
    expect(programInput.readOnly).toBe(true);
    expect(screen.getByText("Environment: Staging")).toBeTruthy();
    const expectedUrl = new URL("/api/v1", window.location.origin).toString();
    const urlInput = screen.getByDisplayValue(expectedUrl) as HTMLInputElement;
    expect(urlInput.readOnly).toBe(true);
    expect(fetchApi.mock.calls.some(([path]) => path === "/admin/settings/api-keys")).toBe(false);
    expect(screen.queryByRole("button", { name: "Create API key" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Open developer documentation" }).getAttribute("href"),
    ).toBe("/document?section=developer");
    fireEvent.click(screen.getByRole("button", { name: "Copy Program ID" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("program-from-session"));
    fireEvent.click(screen.getByRole("button", { name: "Copy API base URL" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expectedUrl));
  });

  it("makes no access or key requests without settings.view", async () => {
    profile.capabilities = { "api_key.manage": true };
    const { container } = renderSettings();
    await waitFor(() => expect(fetchApi).toHaveBeenCalledWith("/admin/me"));
    expect(container.textContent).toBe("");
    expect(fetchApi.mock.calls.some(([path]) => String(path).startsWith("/admin/settings/"))).toBe(
      false,
    );
  });

  it("shows metadata to a key viewer without create, revoke, or existing secret controls", async () => {
    profile.capabilities = { "settings.view": true, "api_key.view": true };
    renderSettings();
    await screen.findByText("Browser integration");
    expect(screen.getByText("CLIENT")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Never")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create API key" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke Browser integration" })).toBeNull();
    expect(screen.queryByLabelText("New API key (shown once)")).toBeNull();
    expect(
      fetchApi.mock.calls.some(
        ([, options]) => options?.method === "POST" || options?.method === "DELETE",
      ),
    ).toBe(false);
  });

  it("defaults to CLIENT and 90 days and keeps the one-time secret out of caches and storage", async () => {
    const localStorageWrite = vi.spyOn(Storage.prototype, "setItem");
    const { client } = renderSettings();
    const input = await createKey();
    const options = postCalls()[0]?.[1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({
      name: "Backend integration",
      scope: "CLIENT",
      expiresInDays: 90,
    });
    expect(input.value).toBe(ONE_TIME_SECRET);
    expect(input.type).toBe("password");
    expect(input.readOnly).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        client
          .getMutationCache()
          .getAll()
          .every((mutation) => mutation.state.data === undefined),
      ).toBe(true),
    );
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.state.data),
      ),
    ).not.toContain(ONE_TIME_SECRET);
    expect(
      localStorageWrite.mock.calls.some((call) =>
        call.some((value) => String(value).includes(ONE_TIME_SECRET)),
      ),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Show API key" }));
    expect(input.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Hide API key" }));
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Copy API key" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ONE_TIME_SECRET));
  });

  it("removes the secret on dismissal and does not recover it after remounting", async () => {
    const first = renderSettings();
    await createKey();
    fireEvent.click(screen.getByRole("button", { name: "I saved it — dismiss" }));
    expect(screen.queryByLabelText("New API key (shown once)")).toBeNull();
    await createKey("Another integration");
    first.unmount();
    renderSettings();
    await screen.findByDisplayValue("program-from-session");
    expect(screen.queryByLabelText("New API key (shown once)")).toBeNull();
  });

  it("clears an existing secret when the admin identity or management permission changes", async () => {
    const { client } = renderSettings();
    await createKey();
    profile = { id: "admin-other", capabilities: fullCapabilities };
    act(() => {
      client.setQueryData(["admin-me"], profile);
    });
    await waitFor(() => expect(screen.queryByLabelText("New API key (shown once)")).toBeNull());
    await createKey("Second admin integration");
    profile = { ...profile, capabilities: { "settings.view": true, "api_key.view": true } };
    act(() => {
      client.setQueryData(["admin-me"], profile);
    });
    await waitFor(() => expect(screen.queryByLabelText("New API key (shown once)")).toBeNull());
    expect(screen.queryByRole("button", { name: "Create API key" })).toBeNull();
  });

  it("discards a create response arriving after the page unmounts", async () => {
    const normalImplementation = fetchApi.getMockImplementation()!;
    let resolveCreate: (value: unknown) => void = () => undefined;
    fetchApi.mockImplementation((path: string, options?: RequestInit) =>
      path === "/admin/settings/api-keys" && options?.method === "POST"
        ? new Promise((resolve) => {
            resolveCreate = resolve;
          })
        : normalImplementation(path, options),
    );
    const view = renderSettings();
    fireEvent.change(await screen.findByLabelText("Key name"), {
      target: { value: "Pending integration" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const signal = (postCalls()[0]?.[1] as RequestInit).signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      resolveCreate({ key: initialKey, secret: ONE_TIME_SECRET });
    });
    expect(
      view.client
        .getMutationCache()
        .getAll()
        .every((mutation) => mutation.state.data === undefined),
    ).toBe(true);
    fetchApi.mockImplementation(normalImplementation);
    renderSettings();
    await screen.findByDisplayValue("program-from-session");
    expect(screen.queryByLabelText("New API key (shown once)")).toBeNull();
  });

  it("validates names and expiry before sending a request and allows explicit no expiry", async () => {
    renderSettings();
    const name = await screen.findByLabelText("Key name");
    expect(screen.getByLabelText("Expires in (days)").getAttribute("data-help")).toContain(
      "does not affect member point expiry",
    );
    expect(screen.getByRole("checkbox", { name: "No expiry" }).getAttribute("data-help")).toContain(
      "remains usable until revoked",
    );
    const submit = screen.getByRole("button", { name: "Create API key" });
    fireEvent.change(name, { target: { value: " " } });
    fireEvent.click(submit);
    expect(screen.getByRole("alert").textContent).toBe("Enter a key name (1–120 characters).");
    fireEvent.change(name, { target: { value: "a".repeat(121) } });
    fireEvent.click(submit);
    expect(postCalls()).toHaveLength(0);
    fireEvent.change(name, { target: { value: "Trusted backend" } });
    for (const value of ["0", "3651", "1.5", ""]) {
      fireEvent.change(screen.getByLabelText("Expires in (days)"), { target: { value } });
      fireEvent.click(submit);
      expect(screen.getByRole("alert").textContent).toContain("Expiry must be a whole number");
    }
    expect(postCalls()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "SERVER" } });
    expect(screen.getByRole("note").textContent).toContain("bypass admin role permissions");
    fireEvent.click(screen.getByRole("checkbox", { name: "No expiry" }));
    fireEvent.click(submit);
    await screen.findByLabelText("New API key (shown once)");
    expect(JSON.parse(String(postCalls()[0]?.[1]?.body))).toEqual({
      name: "Trusted backend",
      scope: "SERVER",
      expiresInDays: null,
    });
  });

  it("requires a revoke confirmation and updates the metadata after revocation", async () => {
    renderSettings();
    const revoke = await screen.findByRole("button", { name: "Revoke Browser integration" });
    fireEvent.click(revoke);
    let dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(/Integrations using this key will stop working immediately/),
    ).toBeTruthy();
    expect(fetchApi.mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(fetchApi.mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(false);
    fireEvent.click(revoke);
    dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke key" }));
    await screen.findByText("API key revoked.");
    expect(fetchApi).toHaveBeenCalledWith("/admin/settings/api-keys/key-existing", {
      method: "DELETE",
    });
    await screen.findByText("Revoked");
    expect(
      (screen.getByRole("button", { name: "Revoke Browser integration" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("explains a server-denied list or create action without exposing a secret", async () => {
    listError = new Error("Forbidden");
    const first = renderSettings();
    expect((await screen.findByRole("alert")).textContent).toContain("Access denied (403)");
    first.unmount();
    listError = null;
    createError = new Error("Request failed with status 403");
    renderSettings();
    fireEvent.change(await screen.findByLabelText("Key name"), {
      target: { value: "Denied integration" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Access denied (403)");
    expect(screen.queryByLabelText("New API key (shown once)")).toBeNull();
  });

  it("keeps a failed revocation visible and reports the server denial", async () => {
    revokeError = new Error("Forbidden");
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke Browser integration" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revoke key" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain("Access denied (403)");
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.queryByText("API key revoked.")).toBeNull();
  });

  it("renders Vietnamese controls, warnings, validation, and clipboard errors", async () => {
    await i18n.changeLanguage("vi-VN");
    writeText.mockRejectedValue(new Error("clipboard blocked"));
    renderSettings();
    await screen.findByDisplayValue("program-from-session");
    expect(screen.getByText("Môi trường: Staging")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sao chép Program ID" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Không truy cập được clipboard",
    );
    fireEvent.click(screen.getByRole("button", { name: "Tạo API key" }));
    expect(screen.getByRole("alert").textContent).toBe("Nhập tên key (1–120 ký tự).");
    fireEvent.change(screen.getByLabelText("Phạm vi"), { target: { value: "SERVER" } });
    expect(screen.getByRole("note").textContent).toContain("bỏ qua phân quyền vai trò Admin");
    expect(screen.getByRole("link", { name: "Mở tài liệu cho lập trình viên" })).toBeTruthy();
  });
});
