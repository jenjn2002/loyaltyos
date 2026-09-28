import { describe, expect, it } from "vitest";

import {
  CampaignActivateSchema,
  CampaignCreateSchema,
  CampaignGetSchema,
  CampaignPauseSchema,
  CampaignsListSchema,
} from "../tools/campaigns.js";

describe("CampaignCreateSchema", () => {
  const required = { pointTypeId: "pt-1", type: "BONUS_POINTS", name: "Test campaign" };

  it("defaults to save as draft", () => {
    const result = CampaignCreateSchema.safeParse({
      ...required,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.saveAsDraft).toBe(true);
      expect(result.data.isStackable).toBe(false);
    }
  });

  it("accepts scheduled campaign fields", () => {
    const result = CampaignCreateSchema.safeParse({
      ...required,
      startsAt: "2024-06-01T00:00:00Z",
      endsAt: "2024-06-02T00:00:00Z",
      multiplier: 2,
      saveAsDraft: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects name over 100 chars", () => {
    const result = CampaignCreateSchema.safeParse({
      name: "x".repeat(101),
      pointTypeId: "pt-1",
      type: "BONUS_POINTS",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = CampaignCreateSchema.safeParse({
      name: "",
      pointTypeId: "pt-1",
      type: "BONUS_POINTS",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid campaign type", () => {
    const result = CampaignCreateSchema.safeParse({
      name: "Test",
      type: "invalid_type",
      pointTypeId: "pt-1",
    });
    expect(result.success).toBe(false);
  });

  it("accepts the API's uppercase campaign type and conditions", () => {
    const result = CampaignCreateSchema.safeParse({
      name: "Spend $50 Get 100 Points",
      pointTypeId: "pt-1",
      type: "SPEND_AND_GET",
      conditions: { spendAmount: 50, earnPoints: 100 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts flash sale campaign type", () => {
    const result = CampaignCreateSchema.safeParse({
      name: "Flash 4x Points",
      pointTypeId: "pt-1",
      type: "FLASH_SALE",
      startsAt: "2024-06-01T00:00:00Z",
      endsAt: "2024-06-02T00:00:00Z",
      multiplier: 4,
      maxUsesPerMember: 3,
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional fields", () => {
    const result = CampaignCreateSchema.safeParse({
      name: "Full Config Campaign",
      pointTypeId: "pt-1",
      type: "FREQUENCY",
      startsAt: "2024-06-01T00:00:00Z",
      endsAt: "2024-07-01T00:00:00Z",
      segmentId: "seg_1",
      conditions: { visits: 5, windowDays: 30, bonusPoints: 200 },
      isStackable: true,
      maxBudget: 10000,
      saveAsDraft: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("CampaignsListSchema", () => {
  it("defaults limit to 20 and offset to 0", () => {
    const result = CampaignsListSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it("filters by status", () => {
    const result = CampaignsListSchema.safeParse({ status: "active" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = CampaignsListSchema.safeParse({ status: "archived" });
    expect(result.success).toBe(false);
  });
});

describe("CampaignGetSchema", () => {
  it("requires campaignId", () => {
    const result = CampaignGetSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts valid campaignId", () => {
    const result = CampaignGetSchema.safeParse({ campaignId: "cam_1" });
    expect(result.success).toBe(true);
  });
});

describe("CampaignActivateSchema", () => {
  it("requires campaignId", () => {
    const result = CampaignActivateSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("CampaignPauseSchema", () => {
  it("accepts campaignId with optional reason", () => {
    const result = CampaignPauseSchema.safeParse({
      campaignId: "cam_1",
      reason: "Budget exceeded",
    });
    expect(result.success).toBe(true);
  });

  it("accepts campaignId without reason", () => {
    const result = CampaignPauseSchema.safeParse({ campaignId: "cam_1" });
    expect(result.success).toBe(true);
  });
});
