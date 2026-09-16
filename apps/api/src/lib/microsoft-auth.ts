import crypto from "node:crypto";

import { decrypt, getMasterKey } from "@loyaltyos/coalition";
import type { MicrosoftAuthConfig } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

import { isCookieSecure } from "./auth/cookie-config.js";
import { LoyaltyError } from "./errors.js";
import { microsoftRedirectUri } from "./public-urls.js";

export const MICROSOFT_PROVIDER = "MICROSOFT";
const STATE_COOKIE = "loyaltyos_microsoft_oauth_state";
const STATE_TTL_SECONDS = 10 * 60;
const TENANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OIDC_SCOPES = ["openid", "profile", "email"] as const;
const emailSchema = z.string().email();

const discoverySchema = z.object({
  issuer: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  jwks_uri: z.string().url(),
});

export interface MicrosoftDiscovery {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

export interface MicrosoftIdentityClaims {
  subject: string;
  tenantId: string;
  email: string | null;
  displayName: string | null;
  givenName: string | null;
  familyName: string | null;
}

interface OAuthState {
  state: string;
  programId: string;
  clientId: string;
  redirectUri: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
}

function stateKey(): string {
  return (
    process.env.JWT_SECRET ?? process.env.KMS_MASTER_KEY ?? "loyaltyos-development-oauth-state"
  );
}

function signState(payload: string): string {
  return crypto.createHmac("sha256", stateKey()).update(payload).digest("base64url");
}

function serializeState(state: OAuthState): string {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  return `${payload}.${signState(payload)}`;
}

function parseState(value: string): OAuthState | null {
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;
  const expected = signState(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  )
    return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.programId !== "string" ||
      typeof parsed.clientId !== "string" ||
      typeof parsed.redirectUri !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.codeVerifier !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt < Math.floor(Date.now() / 1000)
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function cookieValue(request: FastifyRequest): string | null {
  const cookies = request.headers.cookie?.split(";") ?? [];
  for (const cookie of cookies) {
    const [name, ...parts] = cookie.trim().split("=");
    if (name === STATE_COOKIE) {
      try {
        return decodeURIComponent(parts.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function microsoftStateCookie(state: OAuthState): string {
  const secure = isCookieSecure() ? "; Secure" : "";
  return `${STATE_COOKIE}=${encodeURIComponent(serializeState(state))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${String(STATE_TTL_SECONDS)}${secure}`;
}

export function clearMicrosoftStateCookie(): string {
  const secure = isCookieSecure() ? "; Secure" : "";
  return `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function readMicrosoftState(request: FastifyRequest): OAuthState | null {
  const value = cookieValue(request);
  return value ? parseState(value) : null;
}

export function validateMicrosoftConfig(
  config: MicrosoftAuthConfig | null,
): asserts config is MicrosoftAuthConfig {
  if (
    !config?.tenantId ||
    !TENANT_ID_PATTERN.test(config.tenantId) ||
    !config.clientId ||
    !config.encryptedClientSecret
  ) {
    throw new LoyaltyError("MICROSOFT_CONFIG_INCOMPLETE", 409);
  }
  try {
    normalizeMicrosoftScopes(config.scopes);
  } catch {
    throw new LoyaltyError("MICROSOFT_SCOPES_INVALID", 409);
  }
}

export function isMicrosoftTenantId(value: string): boolean {
  return TENANT_ID_PATTERN.test(value.trim());
}

export function normalizeMicrosoftTenantId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!isMicrosoftTenantId(normalized)) throw new LoyaltyError("MICROSOFT_TENANT_ID_INVALID", 400);
  return normalized;
}

export function normalizeMicrosoftScopes(scopes: string[] | undefined): string[] {
  const selected = scopes?.map((scope) => scope.trim()).filter(Boolean) ?? [...OIDC_SCOPES];
  const unique = [...new Set(selected)];
  if (unique.some((scope) => !OIDC_SCOPES.includes(scope as (typeof OIDC_SCOPES)[number]))) {
    throw new LoyaltyError("MICROSOFT_SCOPES_INVALID", 400);
  }
  if (!unique.includes("openid")) throw new LoyaltyError("MICROSOFT_SCOPES_INVALID", 400);
  return OIDC_SCOPES.filter((scope) => unique.includes(scope));
}

/**
 * Only accept an email-shaped claim from the verified ID token. Microsoft
 * tenants can return a non-email preferred_username, so it is never used as
 * an identifier unless it passes the same validation as the email claim.
 */
export function normalizeMicrosoftEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return emailSchema.safeParse(normalized).success ? normalized : null;
}

function normalizeMicrosoftName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 200 ? normalized : null;
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 8_000);
    try {
      const response = await fetch(url, { redirect: "error", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    throw new LoyaltyError("MICROSOFT_PROVIDER_UNAVAILABLE", 502);
  }
}

export async function discoverMicrosoft(config: MicrosoftAuthConfig): Promise<MicrosoftDiscovery> {
  validateMicrosoftConfig(config);
  const tenantId = config.tenantId ?? "";
  const expectedIssuer = `https://login.microsoftonline.com/${tenantId.toLowerCase()}/v2.0`;
  let document: z.infer<typeof discoverySchema>;
  try {
    document = discoverySchema.parse(
      await fetchJson(`${expectedIssuer}/.well-known/openid-configuration`),
    );
  } catch (error) {
    if (error instanceof LoyaltyError) throw error;
    throw new LoyaltyError("MICROSOFT_DISCOVERY_INVALID", 502);
  }
  if (document.issuer.replace(/\/$/, "") !== expectedIssuer) {
    throw new LoyaltyError("MICROSOFT_ISSUER_MISMATCH", 502);
  }
  for (const endpoint of [
    document.authorization_endpoint,
    document.token_endpoint,
    document.jwks_uri,
  ]) {
    const endpointUrl = new URL(endpoint);
    if (endpointUrl.protocol !== "https:" || endpointUrl.hostname !== "login.microsoftonline.com")
      throw new LoyaltyError("MICROSOFT_DISCOVERY_INVALID", 502);
  }
  return {
    issuer: expectedIssuer,
    authorizationEndpoint: document.authorization_endpoint,
    tokenEndpoint: document.token_endpoint,
    jwksUri: document.jwks_uri,
  };
}

export function buildMicrosoftAuthorizationUrl(
  config: MicrosoftAuthConfig,
  discovery: MicrosoftDiscovery,
  programId: string,
): { url: string; stateCookie: string } {
  validateMicrosoftConfig(config);
  const state: OAuthState = {
    state: crypto.randomBytes(32).toString("base64url"),
    programId,
    clientId: config.clientId ?? "",
    redirectUri: microsoftRedirectUri(),
    nonce: crypto.randomBytes(32).toString("base64url"),
    codeVerifier: crypto.randomBytes(48).toString("base64url"),
    expiresAt: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
  };
  const challenge = crypto.createHash("sha256").update(state.codeVerifier).digest("base64url");
  const url = new URL(discovery.authorizationEndpoint);
  url.searchParams.set("client_id", state.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", state.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state.state);
  url.searchParams.set("nonce", state.nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), stateCookie: microsoftStateCookie(state) };
}

export async function exchangeMicrosoftCode(
  config: MicrosoftAuthConfig,
  discovery: MicrosoftDiscovery,
  state: OAuthState,
  code: string,
): Promise<MicrosoftIdentityClaims> {
  validateMicrosoftConfig(config);
  let clientSecret: string;
  try {
    clientSecret = decrypt(config.encryptedClientSecret ?? "", getMasterKey());
  } catch {
    throw new LoyaltyError("MICROSOFT_SECRET_UNREADABLE", 500);
  }
  const params = new URLSearchParams({
    client_id: state.clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: state.redirectUri,
    grant_type: "authorization_code",
    code_verifier: state.codeVerifier,
  });
  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(discovery.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } catch {
    throw new LoyaltyError("MICROSOFT_PROVIDER_UNAVAILABLE", 502);
  }
  if (!tokenResponse.ok) throw new LoyaltyError("MICROSOFT_CODE_INVALID", 401);
  const tokenBody = (await tokenResponse.json()) as { id_token?: unknown };
  if (typeof tokenBody.id_token !== "string") throw new LoyaltyError("MICROSOFT_CODE_INVALID", 401);

  try {
    const verified = await jwtVerify(
      tokenBody.id_token,
      createRemoteJWKSet(new URL(discovery.jwksUri)),
      { issuer: discovery.issuer, audience: state.clientId },
    );
    const payload = verified.payload;
    if (payload.nonce !== state.nonce || typeof payload.sub !== "string") {
      throw new Error("nonce or subject mismatch");
    }
    if (
      typeof payload.tid !== "string" ||
      payload.tid.toLowerCase() !== (config.tenantId ?? "").toLowerCase()
    )
      throw new Error("tenant mismatch");
    const email =
      normalizeMicrosoftEmail(payload.email) ?? normalizeMicrosoftEmail(payload.preferred_username);
    return {
      subject: payload.sub,
      tenantId: payload.tid.toLowerCase(),
      email,
      displayName: normalizeMicrosoftName(payload.name),
      givenName: normalizeMicrosoftName(payload.given_name),
      familyName: normalizeMicrosoftName(payload.family_name),
    };
  } catch (error) {
    if (error instanceof LoyaltyError) throw error;
    throw new LoyaltyError("MICROSOFT_TOKEN_INVALID", 401);
  }
}
