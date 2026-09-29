import { describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({ prisma: {} }));

import { ADMIN_CAPABILITIES, defaultCapability } from "../lib/permissions.js";

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
