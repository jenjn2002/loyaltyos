import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { LoyaltyOSClient } from "./client.js";

export function registerResources(server: McpServer, client: LoyaltyOSClient): void {
  server.resource("Program Overview", "loyaltyos://program/overview", async () => {
    const dashboard = await client.getDashboard();
    const config = await client.getProgramConfig();

    const markdown = [
      `# ${config.name}`,
      "",
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Active Members | ${dashboard.activeMembers.toLocaleString()} |`,
      `| New Members (30d) | ${dashboard.newMembersLast30Days.toLocaleString()} |`,
      `| Points Issued | ${dashboard.totalPointsIssued.toLocaleString()} |`,
      `| Points Redeemed | ${dashboard.totalPointsRedeemed.toLocaleString()} |`,
      `| Redemption Rate | ${(dashboard.redemptionRatio * 100).toFixed(1)}% |`,
      `| Current Point Balance | ${dashboard.currentPointBalance.toLocaleString()} |`,
      `| Coalition Enabled | ${config.coalitionEnabled ? "Yes" : "No"} |`,
      config.coalitionProvider ? `| Coalition Provider | ${config.coalitionProvider} |` : "",
      "",
      "## Tiers",
      "",
      ...config.tiers.map(
        (t) => `- **${t.name}** (≥ ${t.minPoints.toLocaleString()} pts): ${t.benefits.join(", ")}`,
      ),
      "",
      `Point expiry: ${config.pointExpiryDays ? `${String(config.pointExpiryDays)} days` : "Never"}`,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      contents: [
        { uri: "loyaltyos://program/overview", text: markdown, mimeType: "text/markdown" },
      ],
    };
  });

  server.resource("Active Campaigns", "loyaltyos://campaigns/active", async () => {
    const { campaigns } = await client.listCampaigns({ status: "active" });

    if (campaigns.length === 0) {
      return {
        contents: [
          {
            uri: "loyaltyos://campaigns/active",
            text: "# Active Campaigns\n\nNo active campaigns.",
            mimeType: "text/markdown",
          },
        ],
      };
    }

    const markdown = [
      "# Active Campaigns",
      "",
      ...campaigns.map((c) =>
        [
          `## ${c.name}`,
          `- **Type:** ${c.type}`,
          `- **Status:** ${c.isActive ? "active" : c.approvalStatus === "DRAFT" ? "draft" : "paused"}`,
          `- **Start:** ${c.startsAt ?? "Not scheduled"}`,
          c.endsAt ? `- **End:** ${c.endsAt}` : null,
          c.membersReached ? `- **Members Reached:** ${c.membersReached.toLocaleString()}` : null,
          c.pointsIssued ? `- **Points Issued:** ${c.pointsIssued.toLocaleString()}` : null,
          c.conversionRate != null
            ? `- **Conversion Rate:** ${(c.conversionRate * 100).toFixed(1)}%`
            : null,
          `- **Stackable:** ${c.isStackable ? "Yes" : "No"}`,
          c.maxBudget ? `- **Budget Cap:** ${c.maxBudget.toLocaleString()}` : null,
          "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ].join("\n");

    return {
      contents: [
        {
          uri: "loyaltyos://campaigns/active",
          text: markdown,
          mimeType: "text/markdown",
        },
      ],
    };
  });

  server.resource("Tier Configuration", "loyaltyos://tiers/config", async () => {
    const config = await client.getProgramConfig();

    const markdown = [
      "# Tier Configuration",
      "",
      `**Currency:** ${config.currency}`,
      `**Point Expiry:** ${config.pointExpiryDays ? `${String(config.pointExpiryDays)} days` : "Never"}`,
      "",
      "| Tier | Min Points | Benefits |",
      "|------|-----------|----------|",
      ...config.tiers.map(
        (t) => `| ${t.name} | ${t.minPoints.toLocaleString()} | ${t.benefits.join(", ")} |`,
      ),
    ].join("\n");

    return {
      contents: [
        {
          uri: "loyaltyos://tiers/config",
          text: markdown,
          mimeType: "text/markdown",
        },
      ],
    };
  });
}
