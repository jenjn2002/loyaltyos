import type { AuditAction, AuditActorType, Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { requireCapability } from "../../lib/permissions.js";

const auditActions = [
  "ADJUST_POINTS",
  "REVERSE_TRANSACTION",
  "CREATE_COUPON",
  "DELETE_COUPON",
  "UPDATE_CAMPAIGN",
  "UPDATE_REWARD",
  "MERGE_MEMBERS",
  "MANUAL_TIER_CHANGE",
  "CONFIG_CHANGE",
  "OTHER",
  "CREATE_NOTIFICATION_TEMPLATE",
  "UPDATE_NOTIFICATION_TEMPLATE",
  "DELETE_NOTIFICATION_TEMPLATE",
  "CREATE_WEBHOOK",
  "UPDATE_WEBHOOK",
  "DELETE_WEBHOOK",
  "SEND_TEST_NOTIFICATION",
  "PREVIEW_NOTIFICATION_TEMPLATE",
  "CREDIT_GIVE",
  "CREDIT_REDEEM",
  "CREDIT_EXCHANGE",
  "CREDIT_ADJUSTMENT",
  "CREDIT_BULK",
  "CREDIT_BANK",
  "CREDIT_CLEARANCE",
] as const satisfies readonly AuditAction[];

const actorTypes = ["ADMIN_USER", "API_KEY", "MEMBER", "SYSTEM"] as const satisfies readonly AuditActorType[];

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
  action: z.enum(auditActions).optional(),
  actorType: z.enum(actorTypes).optional(),
  actorId: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

interface ActorDetails {
  type: AuditActorType;
  id: string;
  name: string | null;
  email: string | null;
}

export function adminLogsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get(
    "/admin/logs",
    { preHandler: [requireCapability("audit.view")] },
    async (request, reply) => {
      const query = pageSchema.parse(request.query);
      const search = query.q || undefined;
      const where: Prisma.AuditLogWhereInput = {
        programId: request.programId,
        ...(query.action ? { action: query.action } : {}),
        ...(query.actorType ? { actorType: query.actorType } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...((query.from ?? query.to)
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
        ...(search
          ? {
              OR: [
                { actorId: { contains: search, mode: "insensitive" } },
                { entityType: { contains: search, mode: "insensitive" } },
                { entityId: { contains: search, mode: "insensitive" } },
                { reason: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      };

      const [items, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.auditLog.count({ where }),
      ]);

      const adminIds = items.filter((item) => item.actorType === "ADMIN_USER").map((item) => item.actorId);
      const memberIds = items.filter((item) => item.actorType === "MEMBER").map((item) => item.actorId);
      const apiKeyIds = items.filter((item) => item.actorType === "API_KEY").map((item) => item.actorId);
      const [admins, members, apiKeys] = await Promise.all([
        prisma.adminUser.findMany({
          where: { programId: request.programId, id: { in: adminIds } },
          select: { id: true, name: true, email: true },
        }),
        prisma.member.findMany({
          where: { programId: request.programId, id: { in: memberIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        }),
        prisma.apiKey.findMany({
          where: { programId: request.programId, id: { in: apiKeyIds } },
          select: { id: true, name: true },
        }),
      ]);
      const adminById = new Map(admins.map((admin) => [admin.id, admin]));
      const memberById = new Map(members.map((member) => [member.id, member]));
      const apiKeyById = new Map(apiKeys.map((apiKey) => [apiKey.id, apiKey]));

      const actorDetails = (type: AuditActorType, id: string): ActorDetails => {
        if (type === "ADMIN_USER") {
          const admin = adminById.get(id);
          return { type, id, name: admin?.name ?? null, email: admin?.email ?? null };
        }
        if (type === "MEMBER") {
          const member = memberById.get(id);
          const name = member ? [member.firstName, member.lastName].filter(Boolean).join(" ") || null : null;
          return { type, id, name, email: member?.email ?? null };
        }
        if (type === "API_KEY") {
          return { type, id, name: apiKeyById.get(id)?.name ?? null, email: null };
        }
        return { type, id, name: "System", email: null };
      };

      return reply.send({
        data: {
          items: items.map((item) => ({ ...item, actor: actorDetails(item.actorType, item.actorId) })),
          total,
          page: query.page,
          pageSize: query.pageSize,
          totalPages: Math.ceil(total / query.pageSize),
        },
      });
    },
  );

  done();
}
