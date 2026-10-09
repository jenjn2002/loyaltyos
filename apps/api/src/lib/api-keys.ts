import { createHash, randomBytes } from "node:crypto";

import type { ApiKey } from "@prisma/client";

export const API_KEY_METADATA_SELECT = {
  id: true,
  name: true,
  scope: true,
  isActive: true,
  createdAt: true,
  expiresAt: true,
  lastUsedAt: true,
} as const;

export type ApiKeyMetadata = Pick<
  ApiKey,
  "id" | "name" | "scope" | "isActive" | "createdAt" | "expiresAt" | "lastUsedAt"
>;

export function hashApiKeySecret(secret: string): string {
  return `sha256:${createHash("sha256").update(secret).digest("hex")}`;
}

export function createApiKeyCredentials(): { secret: string; keyHash: string } {
  const secret = `los_${randomBytes(32).toString("base64url")}`;
  return { secret, keyHash: hashApiKeySecret(secret) };
}

// Copy the public fields explicitly, even when a caller supplies a complete row.
export function apiKeyMetadata(key: ApiKeyMetadata): ApiKeyMetadata {
  return {
    id: key.id,
    name: key.name,
    scope: key.scope,
    isActive: key.isActive,
    createdAt: key.createdAt,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
  };
}
