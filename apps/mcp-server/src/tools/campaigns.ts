import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { mapAxiosError } from "../errors.js";

const CampaignStatus = z.enum(["active", "draft", "paused", "ended"]);

export const CampaignCreateSchema = z.object({
  name: z.string().min(1).max(100),
  pointTypeId: z.string().min(1).describe("Point type to issue"),
  type: z.enum(["BONUS_POINTS", "SPEND_AND_GET", "FREQUENCY", "MILESTONE", "REFERRAL", "BIRTHDAY", "ANNIVERSARY", "FLASH_SALE", "TIER_UPGRADE_BONUS"]),
  startsAt: z.string().nullable().optional().describe("ISO datetime"),
  endsAt: z.string().nullable().optional().describe("ISO datetime, omit for open-ended"),
  eventType: z.string().optional().describe("Configured trigger event key"),
  segmentId: z.string().optional().describe("Target segment ID; omit for all members"),
  conditions: z.record(z.unknown()).optional().describe("Campaign condition object"),
  multiplier: z.number().int().positive().optional().describe("Points awarded per qualifying event"),
  isStackable: z.boolean().optional().default(false),
  maxBudget: z.number().int().positive().nullable().optional().describe("Omit or null for unlimited"),
  maxUsesPerMember: z.number().int().min(0).optional(),
  issuanceMode: z.enum(["AUTO", "CLAIM"]).optional(),
  issuancePolicy: z.enum(["STANDING", "APPROVAL_REQUIRED"]).optional(),
  saveAsDraft: z.boolean().optional().default(true),
  justification: z.string().optional(),
});

export const CampaignsListSchema = z.object({
  status: CampaignStatus.optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

export const CampaignGetSchema = z.object({
  campaignId: z.string().min(1),
});

export const CampaignActivateSchema = z.object({
  campaignId: z.string().min(1),
});

export const CampaignPauseSchema = z.object({
  campaignId: z.string().min(1),
  reason: z.string().optional().describe("Reason for pausing (for audit log)"),
});

export function registerCampaignTools(server: McpServer, client: LoyaltyOSClient): void {
  server.tool(
    "campaign_create",
    "Create a new loyalty campaign. Supports bonus points, spend-and-get, frequency, milestone, referral, birthday, flash sale, and tier upgrade bonus types.",
    CampaignCreateSchema.shape,
    async (params) => {
      try {
        const result = await client.createCampaign(params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "campaigns_list",
    "List campaigns with optional status filter. Returns active, draft, paused, and ended campaigns.",
    CampaignsListSchema.shape,
    async (params) => {
      try {
        const result = await client.listCampaigns(params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "campaign_get",
    "Get detailed information and performance stats for a specific campaign.",
    CampaignGetSchema.shape,
    async (params) => {
      try {
        const campaign = await client.getCampaign(params.campaignId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(campaign, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "campaign_activate",
    "Activate a draft or paused campaign. The campaign will start processing events immediately.",
    CampaignActivateSchema.shape,
    async (params) => {
      try {
        const result = await client.activateCampaign(params.campaignId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "campaign_pause",
    "Pause an active campaign. It can be reactivated later.",
    CampaignPauseSchema.shape,
    async (params) => {
      try {
        const result = await client.pauseCampaign(params.campaignId, params.reason);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}
