import { describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({ prisma: {} }));

import { ADMIN_CAPABILITIES, capabilityForAdminRequest, defaultCapability } from "../lib/permissions.js";

describe("project finance permission defaults", () => {
  it("requires an explicit grant for project finance outside the owner role", () => {
    expect(ADMIN_CAPABILITIES).toContain("project.finance.view");
    expect(defaultCapability("SUPER_ADMIN", "project.finance.view")).toBe(true);
    expect(defaultCapability("OPERATOR", "project.finance.view")).toBe(false);
    expect(defaultCapability("ANALYST", "project.finance.view")).toBe(false);
    expect(defaultCapability("CUSTOM_ROLE", "project.finance.view")).toBe(false);
  });

  it("keeps ordinary project reads under existing role defaults", () => {
    expect(defaultCapability("OPERATOR", "project.view")).toBe(true);
    expect(defaultCapability("ANALYST", "project.view")).toBe(true);
  });
});

describe("admin request capability mapping", () => {
  it.each([
    ["GET", "/api/v1/admin/point-types", "point_type.view"],
    ["PATCH", "/api/v1/admin/point-types/example", "point_type.manage"],
    ["POST", "/api/v1/admin/point-types/example/adjust", "wallet.adjust"],
    ["GET", "/api/v1/admin/credits/transactions", "wallet.view"],
    ["POST", "/api/v1/admin/credits/adjust", "wallet.adjust"],
    ["GET", "/api/v1/admin/credits/config", "point_type.view"],
    ["GET", "/api/v1/admin/members/example/credentials", "member.credentials.manage"],
    ["PUT", "/api/v1/admin/members/example/credentials", "member.credentials.manage"],
    ["DELETE", "/api/v1/admin/members/example/microsoft-identities/identity", "member.credentials.manage"],
    ["GET", "/api/v1/admin/dashboard-layout", "dashboard.view"],
    ["PATCH", "/api/v1/admin/dashboard-layout", "dashboard.view"],
    ["GET", "/api/v1/admin/settings/api-access", "settings.view"],
    ["GET", "/api/v1/admin/settings/api-keys?limit=20", "api_key.view"],
    ["HEAD", "/api/v1/admin/settings/api-keys", "api_key.view"],
    ["POST", "/api/v1/admin/settings/api-keys", "api_key.manage"],
    ["DELETE", "/api/v1/admin/settings/api-keys/example", "api_key.manage"],
  ])("maps %s %s to %s", (method, url, capability) => {
    expect(capabilityForAdminRequest(method, url)).toBe(capability);
  });
});

describe("API credential permission defaults", () => {
  it.each(["api_key.view", "api_key.manage"] as const)("requires explicit delegation of %s", (capability) => {
    expect(ADMIN_CAPABILITIES).toContain(capability);
    expect(defaultCapability("SUPER_ADMIN", capability)).toBe(true);
    for (const role of ["OPERATOR", "ANALYST", "CUSTOM_ROLE"]) {
      expect(defaultCapability(role, capability)).toBe(false);
    }
  });
});
