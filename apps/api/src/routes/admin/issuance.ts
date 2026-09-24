import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { createApprovalRequest } from "../../lib/approval-workflows.js";
import { audit } from "../../lib/audit.js";
import { LoyaltyError } from "../../lib/errors.js";
import { requireCapability } from "../../lib/permissions.js";

const eventTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .transform((value) => value.toLowerCase().replace(/\s+/g, "_"));

const ruleSchema = z.object({
  pointTypeId: z.string().min(1),
  eventType: eventTypeSchema,
  amount: z.number().int().positive(),
  conditions: z.record(z.unknown()).default({}),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  isActive: z.boolean().default(true),
});

const patchRuleSchema = ruleSchema.partial();

const proposalSchema = z.object({
  memberId: z.string().min(1),
  pointTypeId: z.string().min(1),
  amount: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
  expiresAt: z.string().datetime().optional(),
});

function inputJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function idempotencyKey(request: { headers: Record<string, string | string[] | undefined> }): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 8)
    throw new LoyaltyError("MISSING_IDEMPOTENCY_KEY", 400);
  return value;
}

async function assertPointType(programId: string, pointTypeId: string): Promise<void> {
  const pointType = await prisma.pointTypeDefinition.findFirst({
    where: { id: pointTypeId, programId, isActive: true, archivedAt: null },
    select: { id: true },
  });
  if (!pointType) throw new LoyaltyError("POINT_TYPE_NOT_FOUND", 404);
}

export function adminIssuanceRoutes(
  app: FastifyInstance,
  _opts: unknown,
  done: () => void,
): void {
  app.get(
    "/admin/issuance-rules",
    { preHandler: [requireCapability("issuance.view")] },
    async (request, reply) => {
      const rules = await prisma.pointRule.findMany({
        where: { programId: request.programId },
        include: { pointType: { select: { id: true, code: true, name: true, unitLabel: true } } },
        orderBy: [{ isActive: "desc" }, { eventType: "asc" }, { createdAt: "desc" }],
      });
      return reply.send({ data: rules });
    },
  );

  app.post(
    "/admin/issuance-rules",
    { preHandler: [requireCapability("issuance.manage")] },
    async (request, reply) => {
      const body = ruleSchema.parse(request.body);
      if (body.startsAt && body.endsAt && body.endsAt <= body.startsAt)
        throw new LoyaltyError("POINT_RULE_DATES_INVALID", 400);
      await assertPointType(request.programId, body.pointTypeId);
      const rule = await prisma.pointRule.create({
        data: {
          programId: request.programId,
          pointTypeId: body.pointTypeId,
          eventType: body.eventType,
          multiplier: body.amount,
          conditions: inputJson(body.conditions),
          startsAt: body.startsAt ?? null,
          endsAt: body.endsAt ?? null,
          isActive: body.isActive,
        },
        include: { pointType: { select: { id: true, code: true, name: true, unitLabel: true } } },
      });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "point_rule", rule.id, {
        eventType: rule.eventType,
        pointTypeId: rule.pointTypeId,
        amount: rule.multiplier,
      });
      return reply.status(201).send({ data: rule });
    },
  );

  app.patch(
    "/admin/issuance-rules/:id",
    { preHandler: [requireCapability("issuance.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = patchRuleSchema.parse(request.body);
      const existing = await prisma.pointRule.findFirst({
        where: { id, programId: request.programId },
      });
      if (!existing) throw new LoyaltyError("POINT_RULE_NOT_FOUND", 404);
      const startsAt = body.startsAt === undefined ? existing.startsAt : body.startsAt;
      const endsAt = body.endsAt === undefined ? existing.endsAt : body.endsAt;
      if (startsAt && endsAt && endsAt <= startsAt)
        throw new LoyaltyError("POINT_RULE_DATES_INVALID", 400);
      if (body.pointTypeId) await assertPointType(request.programId, body.pointTypeId);
      const rule = await prisma.pointRule.update({
        where: { id },
        data: {
          ...(body.pointTypeId ? { pointTypeId: body.pointTypeId } : {}),
          ...(body.eventType ? { eventType: body.eventType } : {}),
          ...(body.amount !== undefined ? { multiplier: body.amount } : {}),
          ...(body.conditions !== undefined ? { conditions: inputJson(body.conditions) } : {}),
          ...(body.startsAt !== undefined ? { startsAt: body.startsAt } : {}),
          ...(body.endsAt !== undefined ? { endsAt: body.endsAt } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
        include: { pointType: { select: { id: true, code: true, name: true, unitLabel: true } } },
      });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "point_rule", id, body);
      return reply.send({ data: rule });
    },
  );

  app.delete(
    "/admin/issuance-rules/:id",
    { preHandler: [requireCapability("issuance.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const existing = await prisma.pointRule.findFirst({
        where: { id, programId: request.programId },
        select: { id: true },
      });
      if (!existing) throw new LoyaltyError("POINT_RULE_NOT_FOUND", 404);
      await prisma.pointRule.delete({ where: { id } });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "point_rule", id, {
        deleted: true,
      });
      return reply.status(204).send();
    },
  );

  app.post(
    "/admin/issuance-proposals",
    { preHandler: [requireCapability("wallet.adjust")] },
    async (request, reply) => {
      if (!request.adminId) throw new LoyaltyError("ADMIN_SESSION_REQUIRED", 403);
      const body = proposalSchema.parse(request.body);
      await assertPointType(request.programId, body.pointTypeId);
      const member = await prisma.member.findFirst({
        where: {
          id: body.memberId,
          programId: request.programId,
          deletedAt: null,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
      const key = idempotencyKey(request);
      const approval = await createApprovalRequest({
        programId: request.programId,
        actionKey: "POINT_ISSUANCE_PROPOSAL",
        requestedByType: "ADMIN_USER",
        requestedById: request.adminId,
        requesterAdminId: request.adminId,
        subjectType: "POINT_ISSUANCE_PROPOSAL",
        subjectId: body.memberId,
        idempotencyKey: key,
        payload: inputJson({
          memberId: body.memberId,
          pointTypeId: body.pointTypeId,
          amount: body.amount,
          reason: body.reason,
          expiresAt: body.expiresAt ?? null,
          idempotencyKey: `proposal:${key}`,
        }),
        scopeContext: { pointTypeId: body.pointTypeId, amount: body.amount },
      });
      if (!approval)
        throw new LoyaltyError("POINT_ISSUANCE_WORKFLOW_NOT_CONFIGURED", 409);
      await audit(
        request.programId,
        request.actor,
        "CONFIG_CHANGE",
        "approval_request",
        approval.id,
        body,
        body.reason,
      );
      return reply.status(201).send({ data: approval });
    },
  );

  done();
}
