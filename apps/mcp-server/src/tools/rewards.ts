import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { mapAxiosError } from "../errors.js";

export const RewardsCatalogSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
  maxCost: z.number().int().min(0).optional(),
  category: z.string().optional(),
  availableOnly: z.boolean().optional().default(true),
});

export const RewardCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  pointPrices: z.array(z.object({ pointTypeId: z.string().min(1), amount: z.number().int().positive() })).min(1),
  stock: z.number().int().min(0).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  category: z.string().nullable().optional(),
  tierRequired: z.string().nullable().optional(),
  availableFrom: z.string().nullable().optional().describe("ISO datetime"),
  availableUntil: z.string().nullable().optional().describe("ISO datetime"),
  isActive: z.boolean().optional().default(false),
}).strict();

export const RewardRedemptionStatsSchema = z.object({
  rewardId: z.string().optional().describe("Omit for aggregate stats across all rewards"),
  period: z.enum(["7d", "30d", "90d", "365d"]).optional().default("30d"),
});

export function registerRewardTools(server: McpServer, client: LoyaltyOSClient): void {
  server.tool(
    "rewards_catalog",
    "Browse the loyalty rewards catalog. Members redeem their points for these rewards.",
    RewardsCatalogSchema.shape,
    async (params) => {
      try {
        const result = await client.listRewards(params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "reward_create",
    "Add a new item to the rewards catalog.",
    RewardCreateSchema.shape,
    async (params) => {
      try {
        const result = await client.createReward(params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "reward_redemption_stats",
    "Get redemption statistics for a reward or all rewards.",
    RewardRedemptionStatsSchema.shape,
    async (params) => {
      try {
        const result = await client.getRedemptionStats(params.rewardId, params.period);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}
