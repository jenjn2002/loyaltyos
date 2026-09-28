import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoyaltyOSClient } from "../client.js";
import { mapAxiosError } from "../errors.js";

export const CouponCreateSchema = z.object({
  code: z.string().min(3).max(50).regex(/^[A-Z0-9_-]+$/),
  mode: z.enum(["SHARED", "INDIVIDUAL", "LIMITED"]),
  discountType: z.enum(["PERCENTAGE", "FIXED", "FREE_PRODUCT", "FREE_SHIPPING", "EXTRA_POINTS", "EXPERIENCE"]),
  discountValue: z.number().min(0).optional(),
  minPurchase: z.number().int().min(0).optional(),
  maxUses: z.number().int().min(1).optional(),
  expiresAt: z.string().optional().describe("ISO datetime"),
  maxUsesPerMember: z.number().int().min(1).optional(),
  isStackable: z.boolean().optional(),
  isActive: z.boolean().optional(),
  channels: z.array(z.string().min(1)).optional(),
  startsAt: z.string().optional().describe("ISO datetime"),
});

export function registerCouponTools(server: McpServer, client: LoyaltyOSClient): void {
  server.tool(
    "coupon_create",
    "Create a coupon or batch of unique coupons. Supports percentage discount, fixed amount, free product, free shipping, and bonus points types.",
    CouponCreateSchema.shape,
    async (params) => {
      try {
        const result = await client.createCoupon(params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        mapAxiosError(error);
      }
    },
  );
}
