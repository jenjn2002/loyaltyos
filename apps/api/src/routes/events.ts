import { BadgesService, TiersService } from "@loyaltyos/badges";
import { CampaignsService, evaluateRules } from "@loyaltyos/campaigns";
import { SegmentsService } from "@loyaltyos/segments";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { LoyaltyError } from "../lib/errors.js";
import { notificationsService } from "../lib/notifications-setup.js";
import { walletService } from "../lib/wallets.js";
import { issueOccasion } from "../lib/occasion-issuance.js";

const points = {
  earn: (input: Parameters<typeof walletService.earn>[0]) => walletService.earn(input),
  issue: (input: Parameters<typeof walletService.issue>[0]) => walletService.issue(input),
};
const campaigns = new CampaignsService(prisma, points);
const segments = new SegmentsService(prisma);
const badges = new BadgesService(prisma);
const tiers = new TiersService(prisma);

async function applyIssuanceRules(input: {
  eventId: string;
  type: string;
  memberId: string;
  programId: string;
  amount: number;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
}) {
  const now = new Date();
  const definition = await prisma.eventDefinition.findUnique({ where: { programId_key: { programId: input.programId, key: input.type.toLowerCase() } } });
  const ruleMode = (definition?.automation as { mode?: string } | undefined)?.mode;
  if (definition?.requiresApproval || (definition && !definition.isActive) || (input.type.toLowerCase() !== "purchase" && (!definition || ruleMode !== "EXTERNAL"))) return [];
  const rules = await prisma.pointRule.findMany({
    where: {
      programId: input.programId,
      eventType: input.type.toLowerCase(),
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  const context = {
    type: input.type,
    memberId: input.memberId,
    programId: input.programId,
    amount: input.amount,
    ...(input.payload ?? {}),
  };
  const results = [];
  for (const rule of rules) {
    if (!evaluateRules(rule.conditions as Record<string, unknown> | null, context)) continue;
    // Purchase rules use the event amount as a multiplier base. Standing
    // occasions use the configured multiplier as a fixed grant amount.
    const pointsToIssue =
      input.type.toLowerCase() === "purchase"
        ? Math.floor(input.amount * rule.multiplier)
        : Math.floor(rule.multiplier);
    if (pointsToIssue <= 0) continue;
    const pointInput = {
      memberId: input.memberId,
      programId: input.programId,
      amount: pointsToIssue,
      source: `event:${input.type.toLowerCase()}:rule:${rule.id}`,
      idempotencyKey: `${input.idempotencyKey}-rule-${rule.id}`,
      pointTypeId: rule.pointTypeId ?? undefined,
      metadata: { eventId: input.eventId, eventType: input.type, ...(input.payload ?? {}) },
    };
    results.push(
      input.type.toLowerCase() === "purchase"
        ? await points.earn(pointInput)
        : await points.issue({
            ...pointInput,
            reason: `Automatic issuance rule: ${rule.eventType}`,
          }),
    );
  }
  return results;
}

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
      const normalizedType = body.type.toLowerCase();
      const definition = await prisma.eventDefinition.findUnique({
        where: { programId_key: { programId, key: normalizedType } },
        select: { key: true, isActive: true, automation: true },
      });
      if (normalizedType !== "purchase" && !definition?.isActive) {
        throw new LoyaltyError("ACTIVE_EVENT_DEFINITION_REQUIRED", 400);
      }
      const mode = definition?.automation && typeof definition.automation === "object" && "mode" in definition.automation
        ? (definition.automation as { mode?: unknown }).mode
        : undefined;
      if (normalizedType !== "purchase" && mode && mode !== "EXTERNAL") {
        throw new LoyaltyError("EVENT_IS_SCHEDULED", 409);
      }
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
          const amount =
            body.payload && typeof body.payload === "object" && "amount" in body.payload
              ? Number((body.payload as Record<string, number>).amount)
              : 0;
          const ruleResults = await applyIssuanceRules({
            eventId: event.id,
            type: body.type,
            memberId: body.memberId,
            programId,
            amount: Number.isFinite(amount) ? amount : 0,
            payload: body.payload,
            idempotencyKey,
          });

          // Campaigns can be attached to any member event. A configured
          // segment is checked at event time so dynamic membership stays live.
          const evaluation = await campaigns.evaluateForEvent({
            eventId: event.id,
            type: body.type,
            memberId: body.memberId,
            programId,
            amount: Number.isFinite(amount) ? amount : 0,
            payload: body.payload,
          });
          const appliedCampaigns: unknown[] = [];
          for (const campaign of evaluation.applicable) {
            if (body.type.toLowerCase() !== "purchase") {
              const definition = await prisma.eventDefinition.findUnique({ where: { programId_key: { programId, key: body.type.toLowerCase() } } });
              const config = definition?.automation as { mode?: string } | undefined;
              if (definition && config?.mode === "EXTERNAL") {
                const result = await issueOccasion(campaign.id, body.memberId, idempotencyKey, body.type, body.payload);
                if (result) appliedCampaigns.push(result);
              }
              continue;
            }
            if (campaign.segmentId) {
              const membership = await segments.evaluate(body.memberId, campaign.segmentId);
              if (!membership.belongsTo) continue;
            }
            try {
              const appResult = await campaigns.applyCampaign(
                campaign.id,
                {
                  eventId: event.id,
                  type: body.type,
                  memberId: body.memberId,
                  programId,
                  amount: Number.isFinite(amount) ? amount : 0,
                  payload: body.payload,
                },
                `${idempotencyKey}-campaign-${campaign.id}`,
              );
              appliedCampaigns.push(appResult);
            } catch (err) {
              request.log.warn({ err, campaignId: campaign.id }, "Failed to apply campaign");
            }
          }

          if (body.type === "purchase") {
            // Fire notification, tier and badge hooks for purchase activity.
            void triggerNotification("points.earned", body.memberId, programId, {
              points: ruleResults.reduce((sum, result) => sum + result.amount, 0),
              balances: ruleResults.map((result) => result.balanceAfter),
              amount,
              transactionIds: ruleResults.map((result) => result.transactionId),
            });
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
          }

          await prisma.event.update({
            where: { id: event.id },
            data: { processed: true, processedAt: new Date() },
          });

          if (body.type === "registration") {
            void triggerNotification("registration", body.memberId, programId, {
              bonus: ruleResults.reduce((sum, result) => sum + result.amount, 0),
              points: ruleResults.reduce((sum, result) => sum + result.amount, 0),
              balance: ruleResults[0]?.balanceAfter,
            });
          }

          return reply.status(201).send({
            data: {
              event,
              earnResult: ruleResults[0] ?? null,
              earnResults: ruleResults,
              appliedCampaigns,
            },
          });

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
