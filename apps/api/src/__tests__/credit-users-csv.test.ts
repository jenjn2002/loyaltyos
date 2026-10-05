import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNotifyCreditAdjustment = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../lib/member-notifications.js", () => ({ notifyCreditAdjustment: mockNotifyCreditAdjustment }));
vi.mock("../lib/notifications-setup.js", () => ({ notificationsService: { sendTrigger: vi.fn() } }));

import { notifyChangedImportBalances, parseCsv, validateImportEmail } from "../routes/admin/credit-users.js";

beforeEach(() => vi.clearAllMocks());

describe("member CSV parser", () => {
  it("keeps newlines inside quoted values within one row", () => {
    const rows = parseCsv('email,firstName,department\na@example.com,"Hưng\nTiến",Sales', [], ["email", "firstName", "department"]);
    expect(rows).toEqual([{ email: "a@example.com", firstName: "Hưng\nTiến", department: "Sales" }]);
  });

  it("recognizes a quoted CSV header and retains the optional fields", () => {
    const rows = parseCsv('"email","externalId","firstName","point_MILES"\na@example.com,ext-1,An,25', ["MILES"]);
    expect(rows[0]).toEqual({ email: "a@example.com", externalId: "ext-1", firstName: "An", point_MILES: "25" });
  });

  it("requires email for new members but permits memberId-based updates", () => {
    expect(() => validateImportEmail(undefined, undefined)).toThrowError("BULK_EMAIL_REQUIRED");
    expect(() => validateImportEmail(undefined, null)).toThrowError("BULK_EMAIL_REQUIRED");
    expect(() => validateImportEmail(undefined, "member@example.test")).not.toThrow();
    expect(() => validateImportEmail("member-1", undefined)).not.toThrow();
  });

  it("notifies only imported rows whose point balance actually changed", async () => {
    await notifyChangedImportBalances("program-1", "member-1", [
      { pointTypeId: "point-1", amount: 25, reason: "Import", balanceBefore: 10, balanceAfter: 35 },
      { pointTypeId: "point-2", amount: 0, reason: "Import", balanceBefore: 20, balanceAfter: 20 },
      { pointTypeId: "point-3", amount: -4, reason: "Import", balanceBefore: null, balanceAfter: 6 },
    ]);

    expect(mockNotifyCreditAdjustment).toHaveBeenCalledTimes(1);
    expect(mockNotifyCreditAdjustment).toHaveBeenCalledWith("program-1", "member-1", "point-1", 25, "Import");
  });
});
