import { describe, expect, it } from "vitest";

import { parseCookieSecure, validateProductionConfiguration } from "../lib/runtime-config.js";

const validProductionEnv = {
  NODE_ENV: "production",
  POSTGRES_PASSWORD: "a-database-password-that-is-long-enough",
  JWT_SECRET: "a-jwt-secret-that-is-long-enough-for-production-use",
  API_KEY_SALT: "an-api-key-salt-that-is-long-enough-for-production",
  KMS_MASTER_KEY: "a-kms-master-key-long-enough",
  GIFTCARD_HMAC_SECRET: "a-gift-card-hmac-secret-long-enough-for-prod",
  ADMIN_DEFAULT_EMAIL: "owner@loyalty.example",
  ADMIN_DEFAULT_NAME: "Initial Owner",
  ADMIN_DEFAULT_PASSWORD: "Strong-Initial-Password-123!",
} satisfies NodeJS.ProcessEnv;

describe("production runtime configuration", () => {
  it("defaults cookies to non-secure for the HTTP Docker profile", () => {
    expect(
      parseCookieSecure({
        NODE_ENV: "production",
        PORTAL_URL: "http://192.0.2.10/customer",
        COOKIE_SECURE: "false",
      }),
    ).toBe(false);
    expect(
      parseCookieSecure({ NODE_ENV: "production", PORTAL_URL: "http://192.0.2.10/customer" }),
    ).toBe(false);
    expect(parseCookieSecure({ NODE_ENV: "production", COOKIE_SECURE: "true" })).toBe(true);
  });

  it("keeps secure cookies for an existing HTTPS install when the new flag is omitted", () => {
    expect(
      parseCookieSecure({ NODE_ENV: "production", PORTAL_URL: "https://loyalty.example/customer" }),
    ).toBe(true);
  });

  it("accepts complete production configuration", () => {
    expect(() =>
      validateProductionConfiguration(validProductionEnv, { requireAdminBootstrap: true }),
    ).not.toThrow();
  });

  it("rejects missing or instructional secrets", () => {
    expect(() =>
      validateProductionConfiguration(
        { ...validProductionEnv, JWT_SECRET: "replace-me-with-a-secret" },
        { requireAdminBootstrap: true },
      ),
    ).toThrow(/JWT_SECRET/);
  });

  it("requires initial admin values only when bootstrap is needed", () => {
    const withoutAdmin = { ...validProductionEnv };
    delete withoutAdmin.ADMIN_DEFAULT_EMAIL;
    delete withoutAdmin.ADMIN_DEFAULT_NAME;
    delete withoutAdmin.ADMIN_DEFAULT_PASSWORD;

    expect(() => validateProductionConfiguration(withoutAdmin)).not.toThrow();
    expect(() =>
      validateProductionConfiguration(withoutAdmin, { requireAdminBootstrap: true }),
    ).toThrow(/ADMIN_DEFAULT_EMAIL/);
  });
});
