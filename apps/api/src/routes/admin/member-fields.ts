import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { createdByForEntities } from "../../lib/created-by.js";
import { LoyaltyError } from "../../lib/errors.js";
import { requireCapability } from "../../lib/permissions.js";

const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z][a-z0-9_]*$/, "Key must use lowercase letters, numbers and underscores.");

const optionsSchema = z.array(z.string().trim().min(1).max(120)).max(100).default([]);

const createSchema = z.object({
  key: keySchema,
  label: z.string().trim().min(1).max(120),
  type: z.enum(["TEXT", "NUMBER", "BOOLEAN", "DATE", "SELECT"]).default("TEXT"),
  required: z.boolean().default(false),
  options: optionsSchema,
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

const updateSchema = createSchema.omit({ key: true }).partial();

function optionsJson(options: string[]): Prisma.InputJsonValue {
  return options as unknown as Prisma.InputJsonValue;
}

function validateOptions(type: string | undefined, options: string[] | undefined): void {
  if (type === "SELECT" && (!options || options.length === 0)) {
    throw new LoyaltyError("MEMBER_FIELD_OPTIONS_REQUIRED", 400);
  }
}

export function adminMemberFieldsRoutes(
  app: FastifyInstance,
  _opts: unknown,
  done: () => void,
): void {
  app.get(
    "/admin/member-fields",
    { preHandler: [requireCapability("member.view")] },
    async (request, reply) => {
      const fields = await prisma.memberFieldDefinition.findMany({
        where: { programId: request.programId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
      const creators = await createdByForEntities(
        request.programId,
        "member_field",
        fields.map((field) => field.id),
      );
      return reply.send({
        data: fields.map((field) => ({ ...field, createdBy: creators.get(field.id) ?? null })),
      });
    },
  );

  app.post(
    "/admin/member-fields",
    { preHandler: [requireCapability("member.manage")] },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      validateOptions(body.type, body.options);
      const field = await prisma.memberFieldDefinition.create({
        data: {
          programId: request.programId,
          key: body.key,
          label: body.label,
          type: body.type,
          required: body.required,
          options: optionsJson(body.options),
          sortOrder: body.sortOrder,
          isActive: body.isActive,
        },
      });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "member_field", field.id, {
        key: field.key,
        type: field.type,
      });
      return reply.status(201).send({ data: field });
    },
  );

  app.patch(
    "/admin/member-fields/:id",
    { preHandler: [requireCapability("member.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = updateSchema.parse(request.body);
      const existing = await prisma.memberFieldDefinition.findFirst({
        where: { id, programId: request.programId },
      });
      if (!existing) throw new LoyaltyError("MEMBER_FIELD_NOT_FOUND", 404);
      const type = body.type ?? existing.type;
      const options =
        body.options ??
        (Array.isArray(existing.options)
          ? existing.options.filter((option): option is string => typeof option === "string")
          : []);
      validateOptions(type, options);
      const field = await prisma.memberFieldDefinition.update({
        where: { id },
        data: {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.required !== undefined ? { required: body.required } : {}),
          ...(body.options !== undefined ? { options: optionsJson(body.options) } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
      });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "member_field", id, body);
      return reply.send({ data: field });
    },
  );

  app.delete(
    "/admin/member-fields/:id",
    { preHandler: [requireCapability("member.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const existing = await prisma.memberFieldDefinition.findFirst({
        where: { id, programId: request.programId },
        select: { id: true },
      });
      if (!existing) throw new LoyaltyError("MEMBER_FIELD_NOT_FOUND", 404);
      await prisma.memberFieldDefinition.update({
        where: { id },
        data: { isActive: false },
      });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "member_field", id, {
        isActive: false,
      });
      return reply.status(204).send();
    },
  );

  done();
}
