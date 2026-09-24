import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, isSupportedLocale, resolveLocale } from "../detect.js";

describe("isSupportedLocale", () => {
  it("returns true for vi-VN", () => {
    expect(isSupportedLocale("vi-VN")).toBe(true);
  });

  it("returns true for en-US", () => {
    expect(isSupportedLocale("en-US")).toBe(true);
  });

  it("returns false for unsupported locale", () => {
    expect(isSupportedLocale("fr-FR")).toBe(false);
  });
});

describe("resolveLocale", () => {
  it("returns userPreference first", () => {
    expect(
      resolveLocale({
        userPreference: "en-US",
        browserLanguage: "vi-VN",
      }),
    ).toBe("en-US");
  });

  it("falls back to browserLanguage", () => {
    expect(
      resolveLocale({
        browserLanguage: "en-US",
      }),
    ).toBe("en-US");
  });

  it("falls back to acceptLanguage", () => {
    expect(
      resolveLocale({
        acceptLanguage: "en-US",
      }),
    ).toBe("en-US");
  });

  it("falls back to programDefault", () => {
    expect(
      resolveLocale({
        programDefault: "en-US",
      }),
    ).toBe("en-US");
  });

  it("defaults to vi-VN when nothing matches", () => {
    expect(resolveLocale({})).toBe("vi-VN");
  });

  it("matches language-only prefix via accept-language-parser", () => {
    expect(
      resolveLocale({
        browserLanguage: "vi",
      }),
    ).toBe("vi-VN");
  });

  it("matches en prefix to en-US", () => {
    expect(
      resolveLocale({
        browserLanguage: "en",
      }),
    ).toBe("en-US");
  });

  it("respects resolution order", () => {
    expect(
      resolveLocale({
        acceptLanguage: "en-US",
        userPreference: "vi-VN",
        browserLanguage: "en-US",
      }),
    ).toBe("vi-VN");
  });

  // ── q-weighted Accept-Language ─────────────────────────

  it("handles q-weighted Accept-Language: vi-VN,en;q=0.8", () => {
    expect(
      resolveLocale({
        acceptLanguage: "vi-VN,en;q=0.8",
      }),
    ).toBe("vi-VN");
  });

  it("handles q-weighted Accept-Language: en-US,en;q=0.9", () => {
    expect(
      resolveLocale({
        acceptLanguage: "en-US,en;q=0.9",
      }),
    ).toBe("en-US");
  });

  it("falls back to closest supported when fr-FR has no exact match", () => {
    // fr-FR,fr;q=0.9,en;q=0.5 → en-US is the closest supported
    expect(
      resolveLocale({
        acceptLanguage: "fr-FR,fr;q=0.9,en;q=0.5",
      }),
    ).toBe("en-US");
  });

  it("handles wildcard * → DEFAULT_LOCALE", () => {
    expect(
      resolveLocale({
        acceptLanguage: "*",
      }),
    ).toBe(DEFAULT_LOCALE);
  });

  it("handles empty string → DEFAULT_LOCALE", () => {
    expect(
      resolveLocale({
        acceptLanguage: "",
      }),
    ).toBe(DEFAULT_LOCALE);
  });
});
