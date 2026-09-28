import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { mapAxiosError } from "../errors.js";

export const AnalyticsDashboardSchema = z.object({});

export const AnalyticsCampaignSchema = z.object({
  campaignId: z.string().min(1),
});

export function registerAnalyticsTools(server: McpServer, client: LoyaltyOSClient): void {
  server.tool(
    "analytics_dashboard",
    "Get the main program KPIs: active members, points issued, points redeemed, redemption rate, and top campaigns.",
    AnalyticsDashboardSchema.shape,
    async () => {
      try {
        const result = await client.getDashboard();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "analytics_campaign",
    "Get detailed performance metrics for a specific campaign.",
    AnalyticsCampaignSchema.shape,
    async (params) => {
      try {
        const result = await client.getCampaignStats(params.campaignId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}
