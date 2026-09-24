const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";
const API_KEY: string = (import.meta.env.VITE_API_KEY as string | undefined) ?? "dev-key";
const PROGRAM_ID: string = (import.meta.env.VITE_PROGRAM_ID as string | undefined) ?? "prog_dev";
const APP_BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "");

export function configuredProgramId(): string {
  return PROGRAM_ID;
}

export function startMicrosoftLogin(): void {
  window.location.assign(
    `${API_URL}/admin/auth/microsoft?programId=${encodeURIComponent(PROGRAM_ID)}`,
  );
}

export function appUrl(path = "/"): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${APP_BASE_PATH}${suffix}` || "/";
}

interface RequestOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

interface ApiErrorBody {
  message?: string;
  details?: unknown;
}

function errorMessage(body: { error?: ApiErrorBody }, fallback: string): string {
  const details = body.error?.details;
  if (Array.isArray(details)) {
    const messages = details
      .map((detail) => {
        if (!detail || typeof detail !== "object") return null;
        const item = detail as { path?: unknown[]; message?: unknown };
        const path = Array.isArray(item.path) ? item.path.filter(Boolean).join(".") : "field";
        return typeof item.message === "string" ? `${path}: ${item.message}` : null;
      })
      .filter((message): message is string => Boolean(message));
    if (messages.length) return messages.join("; ");
  }
  const message = body.error?.message;
  if (message && /^[A-Z0-9_]+$/.test(message)) {
    return message
      .toLowerCase()
      .replaceAll("_", " ")
      .replace(/^./, (character) => character.toUpperCase());
  }
  return message ?? fallback;
}

let adminCredentialMode = false;

export function isAdminAuthenticated(): boolean {
  return adminCredentialMode;
}

/** Restore the admin session after a full-page refresh. */
export async function restoreAdminSession(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => {
    controller.abort();
  }, 10_000);
  try {
    const response = await fetch(`${API_URL}/admin/me`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
    adminCredentialMode = response.ok;
    return response.ok;
  } catch {
    adminCredentialMode = false;
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function adminLogin(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(`${API_URL}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    credentials: "include",
  });

  const body = (await response.json()) as {
    data?: unknown;
    error?: ApiErrorBody;
  };

  if (!response.ok) {
    return { ok: false, error: errorMessage(body, "Login failed") };
  }

  adminCredentialMode = true;
  return { ok: true };
}

export async function adminLogout(): Promise<void> {
  await fetch(`${API_URL}/admin/logout`, {
    method: "POST",
    credentials: "include",
  });
  adminCredentialMode = false;
  window.location.href = appUrl("/login");
}

export async function fetchApi<T>(path: string, options?: RequestOptions): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options?.headers,
  };

  // In admin credential mode, rely on cookies, not API key
  if (!adminCredentialMode) {
    headers["X-API-Key"] = API_KEY;
    headers["X-Program-Id"] = PROGRAM_ID;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: adminCredentialMode ? "include" : "omit",
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? ((await response.json()) as { error?: ApiErrorBody; data?: T })
    : ({} as { error?: ApiErrorBody; data?: T });

  if (!response.ok) {
    // If admin session expired, redirect to login
    if (response.status === 401 && adminCredentialMode) {
      adminCredentialMode = false;
      window.location.href = appUrl("/login");
    }
    throw new Error(errorMessage(body, `Request failed with status ${String(response.status)}`));
  }

  return body.data as T;
}
