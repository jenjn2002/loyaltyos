import { describe, expect, it } from "vitest";

import { evaluateRules } from "../rules.js";

describe("evaluateRules", () => {
  it.each([
    ["gt", { gt: 10 }],
    ["lt", { lt: 10 }],
    ["gte", { gte: 10 }],
    ["lte", { lte: 10 }],
    ["between", { between: [0, 10] }],
  ])("does not satisfy %s when its field is missing", (_operator, condition) => {
    expect(evaluateRules({ all: [{ field: "amount", ...condition }] }, {})).toBe(false);
  });

  it("rejects empty and non-finite values for numeric comparisons", () => {
    for (const amount of [null, "", "not-a-number", Number.NaN, true]) {
      expect(evaluateRules({ all: [{ field: "amount", gte: 0 }] }, { amount })).toBe(false);
    }
  });

  it("preserves zero and finite numeric string comparisons", () => {
    expect(evaluateRules({ all: [{ field: "amount", gte: 0 }] }, { amount: 0 })).toBe(true);
    expect(evaluateRules({ all: [{ field: "amount", between: [0, 10] }] }, { amount: "5" })).toBe(true);
  });

  it("does not satisfy legacy numeric operators when the field is missing", () => {
    expect(evaluateRules({ amount: { $gte: 5 } }, {})).toBe(false);
    expect(evaluateRules({ amount: { $lte: 0 } }, { amount: null })).toBe(false);
  });
});
