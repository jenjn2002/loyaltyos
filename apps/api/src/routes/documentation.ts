import type { DocumentationArticleStatus, DocumentationAudience, Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { LoyaltyError } from "../lib/errors.js";
import { requireCapability } from "../lib/permissions.js";

const scenarioSchema = z.object({
  title: z.string().trim().min(1).max(180),
  when: z.string().trim().max(1200).default(""),
  steps: z.array(z.string().trim().min(1).max(1200)).max(30).default([]),
  expected: z.string().trim().max(1600).default(""),
  help: z.string().trim().max(1600).optional(),
});

const localeContentSchema = z.object({
  title: z.string().trim().min(1).max(180),
  section: z.string().trim().min(1).max(120),
  route: z.string().trim().max(240).default("").refine((value) => value === "" || (value.startsWith("/") && !value.startsWith("//")), "Route must be a relative in-app path"),
  purpose: z.string().trim().min(1).max(2400),
  prerequisites: z.string().trim().max(1600).optional(),
  steps: z.array(z.string().trim().min(1).max(1200)).min(1).max(40),
  result: z.string().trim().min(1).max(2400),
  notes: z.array(z.string().trim().min(1).max(1200)).max(30).default([]),
  scenarios: z.array(scenarioSchema).max(20).default([]),
  imageAlt: z.string().trim().max(240).optional(),
});

const screenshotSchema = z.object({
  step: z.number().int().min(1).max(40),
  imageData: z.string().max(240_000).regex(/^data:image\/(jpeg|png|webp);base64,/),
  caption: z.object({ vi: z.string().trim().min(1).max(300), en: z.string().trim().min(1).max(300) }),
});

const articleContentSchema = z.object({
  vi: localeContentSchema,
  en: localeContentSchema,
  screenshots: z.array(screenshotSchema).max(4).optional(),
});

const articleInputSchema = z.object({
  slug: z.string().trim().min(1).max(90).regex(/^[a-z0-9][a-z0-9-]*$/),
  audience: z.enum(["CUSTOMER", "ADMIN"]),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  imageKey: z.string().trim().max(60).nullable().optional(),
  imageData: z.string().max(500_000).regex(/^data:image\/(jpeg|png|webp);base64,/).nullable().optional(),
  content: articleContentSchema,
});

const patchSchema = articleInputSchema.partial().extend({
  content: articleContentSchema.optional(),
});

const articleSelect = {
  id: true,
  audience: true,
  slug: true,
  status: true,
  sortOrder: true,
  imageKey: true,
  imageData: true,
  content: true,
  createdByAdminId: true,
  updatedByAdminId: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DocumentationArticleSelect;

function articleData(input: z.infer<typeof articleInputSchema>): Prisma.DocumentationArticleUncheckedCreateInput {
  return {
    programId: "", // replaced by the request-scoped program id at the call site
    audience: input.audience as DocumentationAudience,
    slug: input.slug,
    status: input.status as DocumentationArticleStatus,
    sortOrder: input.sortOrder,
    imageKey: input.imageKey ?? null,
    imageData: input.imageData ?? null,
    content: input.content as Prisma.InputJsonValue,
    publishedAt: input.status === "PUBLISHED" ? new Date() : null,
  };
}

export function publicDocumentationRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get("/public/documentation", async (request, reply) => {
    const query = z.object({ programId: z.string().trim().min(1).max(80).default("prog_dev") }).parse(request.query);
    const [program, articles] = await Promise.all([
      prisma.program.findUnique({ where: { id: query.programId }, select: { documentationConfigured: true } }),
      prisma.documentationArticle.findMany({
        where: { programId: query.programId, audience: "CUSTOMER", status: "PUBLISHED" },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: articleSelect,
      }),
    ]);
    return reply.send({ data: { articles, configured: program?.documentationConfigured ?? false } });
  });
  done();
}

export function adminDocumentationRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get(
    "/admin/documentation",
    { preHandler: [requireCapability("documentation.view")] },
    async (request, reply) => {
      const query = z.object({ audience: z.enum(["CUSTOMER", "ADMIN"]).optional() }).parse(request.query);
      const [program, articles] = await Promise.all([
        prisma.program.findUnique({ where: { id: request.programId }, select: { documentationConfigured: true } }),
        prisma.documentationArticle.findMany({
          where: { programId: request.programId, ...(query.audience ? { audience: query.audience } : {}) },
          orderBy: [{ audience: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
          select: articleSelect,
        }),
      ]);
      return reply.send({ data: { articles, configured: program?.documentationConfigured ?? false } });
    },
  );

  // One-time, idempotent transfer of the built-in bilingual guides into the
  // article editor. Existing articles are never overwritten by this endpoint.
  app.post(
    "/admin/documentation/seed",
    { bodyLimit: 3_000_000, preHandler: [requireCapability("documentation.manage")] },
    async (request, reply) => {
      const body = z.object({
        articles: z.array(articleInputSchema).min(1).max(100),
        missingOnly: z.boolean().default(false),
      }).parse(request.body);
      const program = await prisma.program.findUnique({ where: { id: request.programId }, select: { documentationConfigured: true } });
      let importedArticles = 0;
      // `missingOnly` is an explicit, repeatable way to add newer built-in
      // procedures to an already configured CMS. Existing authored rows are
      // never updated by this operation.
      if (!program?.documentationConfigured || body.missingOnly) {
        await prisma.$transaction(async (tx) => {
          for (const input of body.articles) {
            const data = articleData(input);
            data.programId = request.programId;
            data.createdByAdminId = request.adminId;
            data.updatedByAdminId = request.adminId;
            const existing = await tx.documentationArticle.findUnique({
              where: {
                programId_audience_slug: {
                  programId: request.programId,
                  audience: input.audience,
                  slug: input.slug,
                },
              },
              select: { id: true },
            });
            if (existing) continue;
            await tx.documentationArticle.upsert({
              where: {
                programId_audience_slug: {
                  programId: request.programId,
                  audience: input.audience,
                  slug: input.slug,
                },
              },
              create: data,
              update: {},
            });
            importedArticles += 1;
          }
          await tx.program.update({ where: { id: request.programId }, data: { documentationConfigured: true } });
          await audit(request.programId, request.actor, "CONFIG_CHANGE", "documentation", null, {
            action: body.missingOnly ? "add_missing_built_in_articles" : "initialize", importedArticles,
          }, undefined, tx);
        });
      }
      const articles = await prisma.documentationArticle.findMany({
        where: { programId: request.programId },
        orderBy: [{ audience: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
        select: articleSelect,
      });
      return reply.send({ data: { articles, configured: true, importedArticles } });
    },
  );

  app.post(
    "/admin/documentation",
    { bodyLimit: 3_000_000, preHandler: [requireCapability("documentation.manage")] },
    async (request, reply) => {
      const input = articleInputSchema.parse(request.body);
      const data = articleData(input);
      data.programId = request.programId;
      data.createdByAdminId = request.adminId;
      data.updatedByAdminId = request.adminId;
      const article = await prisma.$transaction(async (tx) => {
        const created = await tx.documentationArticle.create({ data, select: articleSelect });
        await tx.program.update({ where: { id: request.programId }, data: { documentationConfigured: true } });
        await audit(request.programId, request.actor, "CONFIG_CHANGE", "documentation_article", created.id, {
          action: "create", audience: created.audience, slug: created.slug, status: created.status,
        }, undefined, tx);
        return created;
      });
      return reply.status(201).send({ data: article });
    },
  );

  app.patch(
    "/admin/documentation/:id",
    { bodyLimit: 3_000_000, preHandler: [requireCapability("documentation.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1).max(100) }).parse(request.params);
      const body = patchSchema.parse(request.body);
      const existing = await prisma.documentationArticle.findFirst({
        where: { id, programId: request.programId },
        select: { id: true, status: true },
      });
      if (!existing) throw new LoyaltyError("DOCUMENTATION_ARTICLE_NOT_FOUND", 404);
      const article = await prisma.$transaction(async (tx) => {
        const updated = await tx.documentationArticle.update({
          where: { id },
          data: {
            ...(body.slug !== undefined ? { slug: body.slug } : {}),
            ...(body.audience !== undefined ? { audience: body.audience } : {}),
            ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
            ...(body.imageKey !== undefined ? { imageKey: body.imageKey } : {}),
            ...(body.imageData !== undefined ? { imageData: body.imageData } : {}),
            ...(body.content !== undefined ? { content: body.content as Prisma.InputJsonValue } : {}),
            ...(body.status !== undefined ? {
              status: body.status,
              publishedAt: body.status === "PUBLISHED" ? new Date() : null,
            } : {}),
            updatedByAdminId: request.adminId,
          },
          select: articleSelect,
        });
        await audit(request.programId, request.actor, "CONFIG_CHANGE", "documentation_article", updated.id, {
          action: "update", fields: Object.keys(body), audience: updated.audience,
          status: updated.status, previousStatus: existing.status,
        }, undefined, tx);
        return updated;
      });
      return reply.send({ data: article });
    },
  );

  app.delete(
    "/admin/documentation/:id",
    { preHandler: [requireCapability("documentation.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1).max(100) }).parse(request.params);
      const existing = await prisma.documentationArticle.findFirst({
        where: { id, programId: request.programId },
        select: { id: true, audience: true, slug: true, status: true },
      });
      if (!existing) throw new LoyaltyError("DOCUMENTATION_ARTICLE_NOT_FOUND", 404);
      await prisma.$transaction(async (tx) => {
        await tx.documentationArticle.delete({ where: { id } });
        await audit(request.programId, request.actor, "CONFIG_CHANGE", "documentation_article", id, {
          action: "delete", audience: existing.audience, slug: existing.slug, status: existing.status,
        }, undefined, tx);
      });
      return reply.status(204).send();
    },
  );
  done();
}
