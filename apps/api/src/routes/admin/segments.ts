import { SegmentsService } from "@loyaltyos/segments";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { createdByForEntities } from "../../lib/created-by.js";

const segments = new SegmentsService(prisma);

const ruleConditionSchema = z.object({
  field: z.string().min(1),
  eq: z.unknown().optional(),
  neq: z.unknown().optional(),
  gt: z.number().optional(),
  lt: z.number().optional(),
  gte: z.number().optional(),
  lte: z.number().optional(),
  in: z.array(z.unknown()).optional(),
  between: z.tuple([z.number(), z.number()]).optional(),
  contains: z.string().optional(),
});

const ruleGroupSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    all: z.array(z.union([ruleConditionSchema, ruleGroupSchema])).optional(),
    any: z.array(z.union([ruleConditionSchema, ruleGroupSchema])).optional(),
  }),
);

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(["STATIC", "DYNAMIC"]),
  rules: ruleGroupSchema.optional(),
  memberIds: z.array(z.string().min(1)).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  rules: ruleGroupSchema.optional(),
  memberIds: z.array(z.string().min(1)).optional(),
});

export function adminSegmentsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  // POST /admin/segments — Create segment
  app.post("/admin/segments", async (request, reply) => {
    const body = createSchema.parse(request.body);
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const segment = await segments.create({
      ...body,
      programId,
    } as Parameters<typeof segments.create>[0]);
    await audit(programId, request.actor, "CONFIG_CHANGE", "segment", segment.id, {
      created: true,
      name: segment.name,
    });
    return reply.status(201).send({ data: segment });
  });

  // GET /admin/segments — List segments
  app.get("/admin/segments", async (request, reply) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
        type: z.enum(["STATIC", "DYNAMIC"]).optional(),
        isActive: z
          .enum(["true", "false"])
          .optional()
          .default("true")
          .transform((v) => {
            if (v === "true") return true;
            if (v === "false") return false;
            return undefined;
          }),
        search: z.string().optional(),
      })
      .parse(request.query);

    const programId = request.programId || (request.headers["x-program-id"] as string);
    const result = await segments.list(programId, query);
    const creators = await createdByForEntities(
      programId,
      "segment",
      result.items.map((segment) => segment.id),
    );
    return reply.send({
      data: {
        ...result,
        items: result.items.map((segment) => ({
          ...segment,
          createdBy: creators.get(segment.id) ?? null,
        })),
      },
    });
  });

  // POST /admin/segments/estimate — Estimate segment member count before creation
  app.post("/admin/segments/estimate", async (request, reply) => {
    const { rules } = z.object({ rules: ruleGroupSchema.optional() }).parse(request.body);
    const programId = request.programId || (request.headers["x-program-id"] as string);
    const count = await segments.estimateCount(programId, rules as Record<string, unknown> | null);
    return reply.send({ data: { count } });
  });

  // GET /admin/segments/:id — Get segment by id
  app.get("/admin/segments/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const segment = await segments.getById(id);
    return reply.send({ data: segment });
  });

  // PATCH /admin/segments/:id — Update segment
  app.patch("/admin/segments/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateSchema.parse(request.body);
    const segment = await segments.update(id, body as Parameters<typeof segments.update>[1]);
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "segment", id, body);
    return reply.send({ data: segment });
  });

  // DELETE /admin/segments/:id — Soft delete segment
  app.delete("/admin/segments/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    await segments.delete(id);
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "segment", id, { isActive: false });
    return reply.status(204).send();
  });

  // GET /admin/segments/:id/count — Get member count
  app.get("/admin/segments/:id/count", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const count = await segments.count(id);
    return reply.send({ data: { count } });
  });

  // GET /admin/segments/:id/members — Get segment members
  app.get("/admin/segments/:id/members", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
      })
      .parse(request.query);

    const result = await segments.getMembers(id, query);
    return reply.send({ data: result });
  });

  // POST /admin/segments/:id/members — Add members to static segment
  app.post("/admin/segments/:id/members", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { memberIds } = z
      .object({ memberIds: z.array(z.string().min(1)).min(1) })
      .parse(request.body);

    const segment = await segments.addMembers(id, memberIds);
    return reply.send({ data: segment });
  });

  // DELETE /admin/segments/:id/members — Remove members from static segment
  app.delete("/admin/segments/:id/members", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { memberIds } = z
      .object({ memberIds: z.array(z.string().min(1)).min(1) })
      .parse(request.body);

    const segment = await segments.removeMembers(id, memberIds);
    return reply.send({ data: segment });
  });

  done();
}
