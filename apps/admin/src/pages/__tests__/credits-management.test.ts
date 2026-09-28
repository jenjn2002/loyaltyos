// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { canonicalImportField } from "../credits-management";

describe("member import header normalization", () => {
  it("recognizes the memberId column when reading a UTF-8 BOM CSV export", () => {
    expect(canonicalImportField("\uFEFFmemberId")).toBe("memberid");
  });

  it("recognizes valid quoted CSV headers", () => {
    expect(canonicalImportField('"firstName"')).toBe("firstname");
    expect(canonicalImportField('"externalId"')).toBe("externalid");
  });
});
