import { describe, expect, it } from "vitest";

import { parseCsv, validateImportEmail } from "../routes/admin/credit-users.js";

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
});
