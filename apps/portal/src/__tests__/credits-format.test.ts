import { describe, expect, it } from "vitest";

import { formatExchangeValue } from "../pages/credits";

describe("formatExchangeValue", () => {
  it("normalizes the Vietnamese dong display alias to ISO VND", () => {
    expect(() => formatExchangeValue(100_000, "VNĐ")).not.toThrow();
    expect(formatExchangeValue(100_000, "VNĐ")).toMatch(/100[.,]000|100\.000/);
  });

  it("falls back to a label without crashing for a custom currency symbol", () => {
    expect(formatExchangeValue(25, "credits")).toContain("credits");
  });
});
