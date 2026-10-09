import { describe, expect, it } from "vitest";
import { refreshKnownDashboardDefaults, refreshKnownDocumentationDefaults } from "../lib/documentation-default-refresh.js";

describe("obsolete dashboard default refresh", () => {
  it("updates only exact default statements including scenario copies", () => {
    const old = "The layout is saved in the current browser. Widgets provide an overview; they do not replace the Ledger or detailed reports.";
    const input = { en: { result: old, title: "Authored title", notes: ["Keep my note"], scenarios: [{ expected: old, title: "Custom title" }] }, vi: { result: "My authored policy" }, screenshots: [{ imageData: "private-upload" }] };
    const next = refreshKnownDashboardDefaults(input)!;
    expect(next.changed).toBe(true);
    expect(next.content.en).toMatchObject({ title: "Authored title", notes: ["Keep my note"], result: expect.stringContaining("Admin account") });
    expect(next.content.vi).toEqual(input.vi);
    expect(next.content.screenshots).toEqual(input.screenshots);
    expect(input.en.result).toBe(old);
    expect(refreshKnownDashboardDefaults(next.content)?.changed).toBe(false);
  });
  it("leaves all authored copy and invalid input alone", () => {
    expect(refreshKnownDashboardDefaults(null)).toBe(null);
    const input = { en: { result: "Browser policy written by our team", steps: ["Custom instruction"] } };
    expect(refreshKnownDashboardDefaults(input)).toEqual({ content: input, changed: false });
  });
  it("updates exact obsolete photo/export steps, preserving user edits and image data", () => {
    const input = { en: { steps: ["Select Edit, update standard/custom fields, and enter a Photo URL in the photo field if the image should change.", "Our custom approval step"] }, imageData: "uploaded-image" };
    const next = refreshKnownDocumentationDefaults("how-member-profile-admin", input)!;
    expect(next.content).toMatchObject({ en: { steps: [expect.stringContaining("Upload a photo"), "Our custom approval step"] }, imageData: "uploaded-image" });
    expect(refreshKnownDocumentationDefaults("how-member-profile-admin", next.content)?.changed).toBe(false);
    expect(refreshKnownDocumentationDefaults("other", input)?.changed).toBe(false);
    const points = refreshKnownDocumentationDefaults("how-member-import-points", { vi: { steps: ["Export đúng members và point columns cần cập nhật; giữ nguyên memberId."] } })!;
    expect(points.content).toMatchObject({ vi: { steps: [expect.stringContaining("Email luôn được giữ")] } });
  });
});
