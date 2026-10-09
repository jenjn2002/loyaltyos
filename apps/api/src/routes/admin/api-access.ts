import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import {
  API_KEY_METADATA_SELECT,
  apiKeyMetadata,
  createApiKeyCredentials,
} from "../../lib/api-keys.js";
import { audit } from "../../lib/audit.js";
import { LoyaltyError } from "../../lib/errors.js";
import { assertCapability, requireCapability } from "../../lib/permissions.js";

const createApiKeySchema = z.object({
  name: z.string()
    .refine((name) => !/[\u0000-\u001f\u007f-\u009f]/.test(name), "Name cannot contain control characters")
    .transform((name) => name.trim())
    .pipe(z.string().min(1).max(120)),
  scope: z.enum(["CLIENT", "SERVER"]),
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(90),
}).strict();

// eslint-disable-next-line @typescript-eslint/require-await
async function requireAdminSession(request: FastifyRequest): Promise<void> {
  if (
    !request.adminId ||
    request.actor.type !== "ADMIN_USER" ||
    request.actor.id !== request.adminId
  ) throw new LoyaltyError("FORBIDDEN", 403);
}

async function requireApiKeyRead(request: FastifyRequest): Promise<void> {
  try {
    await assertCapability(request, "api_key.view");
  } catch (error) {
    if (!(error instanceof LoyaltyError) || error.code !== "FORBIDDEN") throw error;
    await assertCapability(request, "api_key.manage");
  }
}

export function adminApiAccessRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.addHook("onRequest", (_request, reply, next) => {
    reply.header("Cache-Control", "no-store").header("Pragma", "no-cache");
    next();
  });

  app.get("/admin/settings/api-access", {
    preHandler: [requireCapability("settings.view")],
  }, async (request, reply) => {
    if (!request.programId) throw new LoyaltyError("PROGRAM_NOT_FOUND", 404);
    const program = await prisma.program.findUnique({
      where: { id: request.programId },
      select: { id: true },
    });
    if (!program) throw new LoyaltyError("PROGRAM_NOT_FOUND", 404);
    return reply.send({ data: {
      programId: program.id,
      environment: process.env.LOYALTYOS_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
      apiBasePath: "/api/v1",
    } });
  });

  app.get("/admin/settings/api-keys", {
    preHandler: [requireAdminSession, requireApiKeyRead],
  }, async (request, reply) => {
    const keys = await prisma.apiKey.findMany({
      where: { programId: request.programId },
      select: API_KEY_METADATA_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return reply.send({ data: { keys: keys.map(apiKeyMetadata) } });
  });

  app.post("/admin/settings/api-keys", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: (request: FastifyRequest) => request.ip } },
    preHandler: [requireAdminSession, requireCapability("api_key.manage")],
  }, async (request, reply) => {
    const body = createApiKeySchema.parse(request.body);
    const result = await prisma.$transaction(async (tx) => {
      const program = await tx.program.findUnique({
        where: { id: request.programId },
        select: { id: true, isActive: true },
      });
      if (!program) throw new LoyaltyError("PROGRAM_NOT_FOUND", 404);
      if (!program.isActive) throw new LoyaltyError("PROGRAM_INACTIVE", 409);
      const { secret, keyHash } = createApiKeyCredentials();
      const key = await tx.apiKey.create({
        data: {
          programId: request.programId,
          name: body.name,
          scope: body.scope,
          key: keyHash,
          isActive: true,
          expiresAt: body.expiresInDays === null ? null : new Date(Date.now() + body.expiresInDays * 86_400_000),
        },
        select: API_KEY_METADATA_SELECT,
      });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "api_key", key.id, {
        operation: "CREATE_API_KEY",
        programId: request.programId,
        name: key.name,
        scope: key.scope,
        expiresAt: key.expiresAt?.toISOString() ?? null,
      }, undefined, tx);
      return { key: apiKeyMetadata(key), secret };
    });
    return reply.status(201).send({ data: result });
  });

  app.delete<{ Params: { id: string } }>("/admin/settings/api-keys/:id", {
    preHandler: [requireAdminSession, requireCapability("api_key.manage")],
  }, async (request, reply) => {
    const key = await prisma.$transaction(async (tx) => {
      const where = { id: request.params.id, programId: request.programId };
      const current = await tx.apiKey.findFirst({ where, select: API_KEY_METADATA_SELECT });
      if (!current) throw new LoyaltyError("API_KEY_NOT_FOUND", 404);
      if (!current.isActive) return apiKeyMetadata(current);
      const updated = await tx.apiKey.updateMany({
        where: { ...where, isActive: true },
        data: { isActive: false },
      });
      const revoked = await tx.apiKey.findFirst({ where, select: API_KEY_METADATA_SELECT });
      if (!revoked) throw new LoyaltyError("API_KEY_NOT_FOUND", 404);
      if (updated.count > 0) {
        await audit(request.programId, request.actor, "CONFIG_CHANGE", "api_key", current.id, {
          operation: "REVOKE_API_KEY",
          programId: request.programId,
          name: current.name,
          scope: current.scope,
          expiresAt: current.expiresAt?.toISOString() ?? null,
        }, undefined, tx);
      }
      return apiKeyMetadata(revoked);
    });
    return reply.send({ data: { key } });
  });

  done();
}
