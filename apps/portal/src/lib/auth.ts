import { configuredProgramId, fetchApi, postApi } from "./api-client";

interface AuthSession {
  token: string | null;
  memberId: string;
  programId: string;
}

export function getSession(): AuthSession | null {
  const token = sessionStorage.getItem("auth-token");
  const memberId = sessionStorage.getItem("member-id");
  const programId = sessionStorage.getItem("program-id");
  if (token && memberId && programId) {
    return { token, memberId, programId };
  }
  if (memberId && programId) {
    return { token: null, memberId, programId };
  }
  return null;
}

export function setSession(session: AuthSession): void {
  if (session.token) sessionStorage.setItem("auth-token", session.token);
  else sessionStorage.removeItem("auth-token");
  sessionStorage.setItem("member-id", session.memberId);
  sessionStorage.setItem("program-id", session.programId);
}

export function clearSession(): void {
  sessionStorage.removeItem("auth-token");
  sessionStorage.removeItem("member-id");
  sessionStorage.removeItem("program-id");
}

export function isAuthenticated(): boolean {
  return sessionStorage.getItem("member-id") !== null;
}

/** Restore a Microsoft/OIDC session that is held in the HttpOnly Lucia cookie. */
export async function bootstrapSession(): Promise<boolean> {
  if (isAuthenticated()) return true;
  try {
    const member = await fetchApi<{ id: string; programId: string }>("/auth/me");
    if (!member.id || !member.programId) return false;
    setSession({ token: null, memberId: member.id, programId: member.programId });
    return true;
  } catch {
    return false;
  }
}

export interface AuthMethods {
  password: boolean;
  microsoft: boolean;
}

export async function getAuthMethods(): Promise<AuthMethods> {
  return fetchApi<AuthMethods>("/auth/methods");
}

export async function loginWithPassword(username: string, password: string): Promise<AuthSession> {
  const result = await postApi<{
    sessionId: string;
    expiresAt: string;
    member: { id: string; programId: string };
  }>("/auth/login", { username, password });
  const session = {
    token: result.sessionId,
    memberId: result.member.id,
    programId: result.member.programId,
  };
  setSession(session);
  return session;
}

export function startMicrosoftLogin(): void {
  window.location.assign(
    `/api/v1/auth/microsoft?programId=${encodeURIComponent(configuredProgramId())}`,
  );
}

export async function sendMagicLink(email: string, locale = "vi-VN"): Promise<void> {
  await postApi("/auth/magic-link", { email, locale });
}

export async function verifyMagicLink(token: string): Promise<AuthSession> {
  const result = await postApi<{
    sessionId: string;
    expiresAt: string;
    member: {
      id: string;
      email: string | null;
      phone: string | null;
      firstName: string | null;
      lastName: string | null;
      programId: string;
      joinedAt: string;
    };
  }>("/auth/verify-magic-link", { token });
  const session = {
    token: result.sessionId,
    memberId: result.member.id,
    programId: result.member.programId,
  };
  setSession(session);
  return session;
}

export async function loginWithOtp(email: string, otp: string): Promise<AuthSession> {
  const result = await postApi<AuthSession>("/auth/otp", { email, otp });
  setSession(result);
  return result;
}

export async function getProfile() {
  return fetchApi<{
    id: string;
    email: string | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    joinedAt: string;
  }>("/members/me");
}
