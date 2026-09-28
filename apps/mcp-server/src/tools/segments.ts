import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { mapAxiosError } from "../errors.js";

export const SegmentCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(["STATIC", "DYNAMIC"]).default("DYNAMIC"),
  rules: z.record(z.unknown()).optional().describe("Nested rule group, e.g. {all:[{field:'department',eq:'Sales'}]}"),
  memberIds: z.array(z.string().min(1)).optional(),
}).strict();

export const SegmentsListSchema = z.object({});

export const SegmentPreviewSchema = z.object({
  rules: z.record(z.unknown()),
}).strict();

export function registerSegmentTools(server: McpServer, client: LoyaltyOSClient): void {
  server.tool(
    "segment_create",
    "Create a dynamic customer segment based on behavioral and profile rules. Segments auto-update as member data changes.",
    SegmentCreateSchema.shape,
    async (params) => {
      try {
        const result = await client.createSegment(params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "segments_list",
    "List all segments with their current member counts.",
    SegmentsListSchema.shape,
    async () => {
      try {
        const result = await client.listSegments();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );

  server.tool(
    "segment_preview",
    "Preview how many members would match a set of rules before creating a segment. Use this before campaign_create to validate the audience.",
    SegmentPreviewSchema.shape,
    async (params) => {
      try {
        const result = await client.previewSegment(params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}
