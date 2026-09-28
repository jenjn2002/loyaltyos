import { describe, expect, it } from "vitest";

import {
  SegmentCreateSchema,
  SegmentPreviewSchema,
  SegmentsListSchema,
} from "../tools/segments.js";

describe("SegmentCreateSchema", () => {
  it("accepts valid segment with rules", () => {
    const result = SegmentCreateSchema.safeParse({
      name: "High Value Gold Members",
      type: "DYNAMIC",
      rules: { all: [{ field: "department", eq: "Sales" }] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("DYNAMIC");
    }
  });

  it("rejects empty rules array", () => {
    const result = SegmentCreateSchema.safeParse({
      name: "Empty Rules",
      rules: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a static segment without rules", () => {
    const result = SegmentCreateSchema.safeParse({ name: "Manual group", type: "STATIC", memberIds: ["member-1"] });
    expect(result.success).toBe(true);
  });

  it("preserves nested rule groups for the API", () => {
    const result = SegmentCreateSchema.safeParse({
      name: "Sales group",
      type: "DYNAMIC",
      rules: { any: [{ field: "department", eq: "Sales" }, { field: "department", eq: "Marketing" }] },
    });
    expect(result.success).toBe(true);
  });
});

describe("SegmentPreviewSchema", () => {
  it("accepts API rule groups", () => {
    const result = SegmentPreviewSchema.safeParse({
      rules: { all: [{ field: "accountAgeDays", gte: 60 }] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty rules", () => {
    const result = SegmentPreviewSchema.safeParse({ rules: [] });
    expect(result.success).toBe(false);
  });
});

describe("SegmentsListSchema", () => {
  it("accepts empty object", () => {
    const result = SegmentsListSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
