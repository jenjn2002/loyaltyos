import { BadgesService, TiersService } from "@loyaltyos/badges";
import { CampaignsService, evaluateRules } from "@loyaltyos/campaigns";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { LoyaltyError } from "../lib/errors.js";
import { notificationsService } from "../lib/notifications-setup.js";
import { walletService } from "../lib/wallets.js";

const points = {
  earn: (input: Parameters<typeof walletService.earn>[0]) => walletService.earn(input),
};
const campaigns = new CampaignsService(prisma, points);
const badges = new BadgesService(prisma);
const tiers = new TiersService(prisma);

/** Fire a notification trigger asynchronously (fire-and-forget). */
async function triggerNotification(
  triggerEvent: string,
  memberId: string,
  programId: string,
  baseContext: Record<string, unknown>,
): Promise<void> {
  try {
    const member = await prisma.member.findFirst({
      where: { id: memberId },
      include: {
        memberTiers: { include: { tier: true } },
      },
    });
    const currentTier = member?.memberTiers.find((mt) => !mt.downgradedAt)?.tier.name;
    const context: Record<string, unknown> = {
      ...baseContext,
      member: {
        id: member?.id,
        email: member?.email,
        phone: member?.phone,
        firstName: member?.firstName,
        lastName: member?.lastName,
        currentTier,
      },
    };
    await notificationsService.sendTrigger(programId, triggerEvent, memberId, context);
  } catch (err) {
    // Fire-and-forget: never fail the main operation
    console.error(`[Notifications] Trigger ${triggerEvent} failed:`, err);
  }
}

const eventSchema = z.object({
  type: z.string().min(1),
  memberId: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});

export function eventsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.post(
    "/events",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const idempotencyKey = request.headers["idempotency-key"] as string;
      if (!idempotencyKey) {
        return reply.status(400).send({
          error: { code: "MISSING_HEADER", message: "Idempotency-Key header is required" },
        });
      }

      const body = eventSchema.parse(request.body);

      // Deduplicate the event
      const programId = request.programId || (request.headers["x-program-id"] as string);
      const existing = await prisma.event.findUnique({
        where: { programId_idempotencyKey: { programId, idempotencyKey } },
      });
      if (existing) {
        if (existing.type !== body.type || existing.memberId !== (body.memberId ?? null)) {
          throw new LoyaltyError("EVENT_IDEMPOTENCY_CONFLICT", 409);
        }
        return reply.send({ data: existing, idempotent: true });
      }

      if (body.memberId) {
        const member = await prisma.member.findFirst({
          where: {
            id: body.memberId,
            programId,
            deletedAt: null,
            status: "ACTIVE",
          },
          select: { id: true },
        });
        if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
      }

      // Create event
      const event = await prisma.event.create({
        data: {
          programId,
          type: body.type,
          memberId: body.memberId,
          payload: body.payload as Prisma.InputJsonValue,
          idempotencyKey,
          processed: false,
        },
      });

      // If the event is for a member and represents points-earning activity,
      // process it through the points engine
      if (body.memberId) {
        // Update lastActiveAt (fire-and-forget — don't block the event)
        void prisma.member
          .update({
            where: { id: body.memberId },
            data: { lastActiveAt: new Date() },
          })
          .catch(() => {
            /* best-effort */
          });

        try {
          // For "purchase" events, earn points
          if (body.type === "purchase") {
            const amount =
              body.payload && typeof body.payload === "object" && "amount" in body.payload
                ? Number((body.payload as Record<string, number>).amount)
                : 0;

            if (amount > 0) {
              const rules = await prisma.pointRule.findMany({
                where: {
                  programId,
                  eventType: body.type,
                  isActive: true,
                  AND: [
                    { OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] },
                    { OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
                  ],
                },
                orderBy: { createdAt: "asc" },
              });
              const ruleContext = {
                type: body.type,
                memberId: body.memberId,
                programId,
                amount,
                ...(body.payload ?? {}),
              };
              const matchingRules = rules.filter((rule) =>
                evaluateRules(rule.conditions as Record<string, unknown> | null, ruleContext),
              );
              const earnResults = [];
              for (const rule of matchingRules) {
                const pointsToEarn = Math.floor(amount * rule.multiplier);
                if (pointsToEarn <= 0) continue;
                earnResults.push(
                  await points.earn({
                    memberId: body.memberId,
                    programId,
                    amount: pointsToEarn,
                    source: `event:${body.type}:rule:${rule.id}`,
                    idempotencyKey: `${idempotencyKey}-earn-${rule.id}`,
                    metadata: body.payload,
                    pointTypeId: rule.pointTypeId ?? undefined,
                  }),
                );
              }

              // Evaluate and apply eligible campaigns
              const evaluation = await campaigns.evaluateForEvent({
                eventId: event.id,
                type: body.type,
                memberId: body.memberId,
                programId: programId,
                amount,
                payload: body.payload,
              });

              const appliedCampaigns: unknown[] = [];
              for (const campaign of evaluation.applicable) {
                try {
                  const appResult = await campaigns.applyCampaign(
                    campaign.id,
                    {
                      eventId: event.id,
                      type: body.type,
                      memberId: body.memberId,
                      programId: programId,
                      amount,
                      payload: body.payload,
                    },
                    `${idempotencyKey}-campaign-${campaign.id}`,
                  );
                  appliedCampaigns.push(appResult);
                } catch (err) {
                  request.log.warn({ err, campaignId: campaign.id }, "Failed to apply campaign");
                }
              }

              await prisma.event.update({
                where: { id: event.id },
                data: {
                  processed: true,
                  processedAt: new Date(),
                },
              });

              // Fire notification trigger (fire-and-forget)
              void triggerNotification("points.earned", body.memberId, programId, {
                points: earnResults.reduce((sum, result) => sum + result.amount, 0),
                balances: earnResults.map((result) => result.balanceAfter),
                amount,
                transactionIds: earnResults.map((result) => result.transactionId),
              });

              // Evaluate tier changes (fire-and-forget)
              void (async () => {
                try {
                  const tierResult = await tiers.evaluateMember(body.memberId!, programId);
                  if (tierResult.changed && tierResult.direction === "upgrade") {
                    void triggerNotification("tier.changed", body.memberId!, programId, {
                      previousTier: tierResult.previousTier?.name,
                      currentTier: tierResult.currentTier?.name,
                      direction: "upgrade",
                    });
                  }
                } catch (err) {
                  console.error("[Tiers] Evaluation failed:", err);
                }
              })();

              // Evaluate badges for this event (fire-and-forget)
              void (async () => {
                try {
                  const badgeResult = await badges.evaluateOnEvent({
                    type: body.type,
                    memberId: body.memberId!,
                    programId,
                    amount,
                    payload: body.payload,
                  });
                  for (const unlocked of badgeResult.unlocked) {
                    void triggerNotification("badge.unlocked", body.memberId!, programId, {
                      badgeId: unlocked.id,
                      badgeName: unlocked.name,
                      badgeType: unlocked.type,
                    });
                  }
                } catch (err) {
                  console.error("[Badges] Evaluation failed:", err);
                }
              })();

              return reply.status(201).send({
                data: {
                  event,
                  earnResult: earnResults[0] ?? null,
                  earnResults,
                  appliedCampaigns,
                },
              });
            }
          }

          // Registration awards are configuration-driven. Without a matching
          // point rule there is deliberately no hidden hard-coded bonus.
          if (body.type === "registration") {
            const registrationRules = await prisma.pointRule.findMany({
              where: { programId, eventType: "registration", isActive: true },
              orderBy: { createdAt: "asc" },
            });
            const rule = registrationRules.find((candidate) =>
              evaluateRules(candidate.conditions as Record<string, unknown> | null, {
                type: body.type,
                memberId: body.memberId,
                programId,
                ...(body.payload ?? {}),
              }),
            );
            const bonus = rule ? Math.max(0, Math.floor(rule.multiplier)) : 0;
            const result =
              bonus > 0
                ? await points.earn({
                    memberId: body.memberId,
                    programId,
                    amount: bonus,
                    source: "event:registration",
                    idempotencyKey: `${idempotencyKey}-bonus`,
                    pointTypeId: rule?.pointTypeId ?? undefined,
                  })
                : null;

            await prisma.event.update({
              where: { id: event.id },
              data: { processed: true, processedAt: new Date() },
            });

            // Fire notification trigger (fire-and-forget)
            void triggerNotification("registration", body.memberId, programId, {
              bonus,
              points: result?.amount ?? 0,
              balance: result?.balanceAfter,
            });

            return reply.status(201).send({ data: { event, earnResult: result } });
          }
        } catch (err) {
          await prisma.event.update({
            where: { id: event.id },
            data: { error: String(err) },
          });
          throw err;
        }
      }

      return reply.status(201).send({ data: event });
    },
  );

  done();
}
