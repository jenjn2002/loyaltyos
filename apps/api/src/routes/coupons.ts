import { CouponsService } from "@loyaltyos/coupons";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { adaptCouponsMetrics, getBusinessMetrics } from "../lib/business-metrics.js";
import { LoyaltyError } from "../lib/errors.js";

const coupons = new CouponsService(prisma, adaptCouponsMetrics(getBusinessMetrics()));

const validateSchema = z.object({
  code: z.string().min(1),
  memberId: z.string().min(1),
  purchaseAmount: z.number().min(0).optional(),
  channel: z.string().optional(),
});

const redeemSchema = validateSchema;

function assertCouponMember(request: {
  memberId: string | null;
  adminId: string | null;
  apiKeyScope: string;
  actor: { type: string };
}, requestedMemberId: string): void {
  if (request.memberId) {
    if (request.memberId !== requestedMemberId) throw new LoyaltyError("FORBIDDEN", 403);
    return;
  }
  if (request.adminId || (request.apiKeyScope === "SERVER" && request.actor.type === "API_KEY")) return;
  throw new LoyaltyError("FORBIDDEN", 403);
}

export function couponsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  // POST /coupons/validate — Validate a coupon without redeeming
  app.post("/coupons/validate", async (request, reply) => {
    const body = validateSchema.parse(request.body);
    assertCouponMember(request, body.memberId);
    const result = await coupons.validate(body.code, {
      programId: request.programId,
      memberId: body.memberId,
      purchaseAmount: body.purchaseAmount,
      channel: body.channel,
    });
    return reply.send({ data: result });
  });

  // POST /coupons/redeem — Validate and redeem a coupon
  app.post("/coupons/redeem", async (request, reply) => {
    const body = redeemSchema.parse(request.body);
    assertCouponMember(request, body.memberId);
    const result = await coupons.redeem(body.code, {
      programId: request.programId,
      memberId: body.memberId,
      purchaseAmount: body.purchaseAmount,
      channel: body.channel,
    });
    return reply.send({ data: result });
  });

  done();
}
