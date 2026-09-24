import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { createdByForEntities } from "../../lib/created-by.js";
import { LoyaltyError } from "../../lib/errors.js";
import { requireCapability } from "../../lib/permissions.js";
import { ANNUAL_MEMBER_DATE_MODES, automationSchema } from "../../lib/occasion-schedule.js";

const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_.-]*$/, "Event key must use lowercase letters, numbers, dots, dashes or underscores.");

const createSchema = z.object({
  key: keySchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().default(true),
  automation: automationSchema.default({}),
  // Accepted for backwards compatibility. Approval is configured per campaign.
  requiresApproval: z.boolean().optional(),
});

const updateSchema = createSchema.omit({ key: true }).partial();

async function validateDateField(programId: string, automation: z.infer<typeof automationSchema>) {
  if (!["ONBOARDING", ...ANNUAL_MEMBER_DATE_MODES].includes(automation.mode) || automation.dateField === "joinedAt") return;
  const field = await prisma.memberFieldDefinition.findFirst({ where: { programId, key: automation.dateField.slice(9), type: "DATE", isActive: true } });
  if (!field) throw new LoyaltyError("ACTIVE_MEMBER_DATE_FIELD_REQUIRED", 400);
}

export function adminEventDefinitionsRoutes(
  app: FastifyInstance,
  _opts: unknown,
  done: () => void,
): void {
  app.get(
    "/admin/event-definitions",
    { preHandler: [requireCapability("event.view")] },
    async (request, reply) => {
      const definitions = await prisma.eventDefinition.findMany({
        where: { programId: request.programId },
        orderBy: [{ isActive: "desc" }, { key: "asc" }],
      });
      const creators = await createdByForEntities(
        request.programId,
        "event_definition",
        definitions.map((definition) => definition.id),
      );
      return reply.send({
        data: definitions.map((definition) => ({
          ...definition,
          createdBy: creators.get(definition.id) ?? null,
        })),
      });
    },
  );

  app.post(
    "/admin/event-definitions",
    { preHandler: [requireCapability("event.manage")] },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      await validateDateField(request.programId, body.automation);
      const definition = await prisma.eventDefinition.create({
        data: {
          programId: request.programId,
          key: body.key,
          name: body.name,
          description: body.description,
          isActive: body.isActive,
          automation: body.automation,
          requiresApproval: body.requiresApproval ?? true,
        },
      });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "event_definition", definition.id, {
        key: definition.key,
        name: definition.name,
      });
      return reply.status(201).send({ data: definition });
    },
  );

  app.patch(
    "/admin/event-definitions/:id",
    { preHandler: [requireCapability("event.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = updateSchema.parse(request.body);
      if (body.automation) await validateDateField(request.programId, body.automation);
      const existing = await prisma.eventDefinition.findFirst({
        where: { id, programId: request.programId },
      });
      if (!existing) throw new LoyaltyError("EVENT_DEFINITION_NOT_FOUND", 404);
      // Changing an occasion cannot silently change the meaning of an approved campaign.
      if (body.automation || body.requiresApproval !== undefined) {
        const used = await prisma.campaign.count({ where: { programId: request.programId, eventType: existing.key, deletedAt: null } });
        if (used) throw new LoyaltyError("EVENT_IN_USE_CREATE_NEW_DEFINITION", 409);
      }
      const definition = await prisma.eventDefinition.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(body.automation ? { automation: body.automation } : {}),
          // Keep the legacy column writable for old clients, but new policy
          // decisions are made by campaigns.
          ...(body.requiresApproval !== undefined ? { requiresApproval: body.requiresApproval } : {}),
        },
      });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "event_definition", id, body);
      return reply.send({ data: definition });
    },
  );

  app.delete(
    "/admin/event-definitions/:id",
    { preHandler: [requireCapability("event.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const existing = await prisma.eventDefinition.findFirst({
        where: { id, programId: request.programId },
        select: { id: true },
      });
      if (!existing) throw new LoyaltyError("EVENT_DEFINITION_NOT_FOUND", 404);
      await prisma.eventDefinition.update({ where: { id }, data: { isActive: false } });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "event_definition", id, {
        isActive: false,
      });
      return reply.status(204).send();
    },
  );

  done();
}
