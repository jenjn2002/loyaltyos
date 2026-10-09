import { describe, expect, it } from "vitest";
import { adminScreenshotSlugs, guideScreenshot } from "../document-screenshots";

describe("bundled real admin screenshots", () => {
  const article = { audience: "ADMIN" as const, slug: "dashboard", imageKey: "dashboard", imageData: null };
  it("covers all 25 overview guides without changing CMS content", () => {
    expect(adminScreenshotSlugs.size).toBe(25);
    expect(guideScreenshot(article)).toMatch(/documentation\/admin-dashboard\.jpg$/);
  });
  it("prioritizes an uploaded image and respects explicit removal", () => {
    expect(guideScreenshot({ ...article, imageData: "data:image/png;base64,test" })).toBe("data:image/png;base64,test");
    expect(guideScreenshot({ ...article, imageKey: null })).toBe(null);
    expect(guideScreenshot({ ...article, audience: "CUSTOMER" })).toBe(null);
    expect(guideScreenshot({ ...article, slug: "authored-guide" })).toBe(null);
  });
});
