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
  actor: z.string().trim().max(100).optional(),
  action: z.enum(auditActions).optional(),
  actorType: z.enum(actorTypes).optional(),
  actorId: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).superRefine((query, context) => {
  if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "End date must be on or after start date" });
  }
});

interface ActorDetails {
  type: AuditActorType;
  id: string;
  name: string | null;
  email: string | null;
}

export function adminLogsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get(
    "/admin/logs/filters",
    { preHandler: [requireCapability("audit.view")] },
    async (request, reply) => {
      const features = await prisma.auditLog.findMany({
        where: { programId: request.programId },
        distinct: ["entityType"],
        select: { entityType: true },
        orderBy: { entityType: "asc" },
      });
      return reply.send({ data: { features: features.map((item) => item.entityType) } });
    },
  );

  app.get(
    "/admin/logs",
    { preHandler: [requireCapability("audit.view")] },
    async (request, reply) => {
      const query = pageSchema.parse(request.query);
      const search = query.q || undefined;
      const actorSearch = query.actor || undefined;
      const searchableDiffFields = [
        "action",
        "actionKey",
        "code",
        "email",
        "eventType",
        "memberId",
        "name",
        "operation",
        "pointTypeId",
        "reason",
        "status",
      ];

      const identityTerms = [...new Set([search, actorSearch].filter((term): term is string => Boolean(term && term.length >= 2)))];
      const identityIdsByTerm = new Map<string, string[]>();
      await Promise.all(identityTerms.map(async (term) => {
        const contains = { contains: term, mode: "insensitive" as const };
        const [admins, members, apiKeys] = await Promise.all([
          prisma.adminUser.findMany({
            where: { programId: request.programId, OR: [{ name: contains }, { email: contains }] },
            select: { id: true },
          }),
          prisma.member.findMany({
            where: { programId: request.programId, OR: [{ firstName: contains }, { lastName: contains }, { email: contains }] },
            select: { id: true },
          }),
          prisma.apiKey.findMany({ where: { programId: request.programId, name: contains }, select: { id: true } }),
        ]);
        identityIdsByTerm.set(term, [...new Set([...admins, ...members, ...apiKeys].map((item) => item.id))]);
      }));

      const targetMatchesFor = async (term: string): Promise<Prisma.AuditLogWhereInput[]> => {
        if (term.length < 2) return [];
        const contains = { contains: term, mode: "insensitive" as const };
        const [campaigns, coupons, rewards, segments, tiers, badges, events, workflows, approvalRequests, pointTypes, cycles, members] = await Promise.all([
          prisma.campaign.findMany({ where: { programId: request.programId, name: contains }, select: { id: true } }),
          prisma.coupon.findMany({ where: { programId: request.programId, code: contains }, select: { id: true } }),
          prisma.reward.findMany({ where: { programId: request.programId, name: contains }, select: { id: true } }),
          prisma.segment.findMany({ where: { programId: request.programId, name: contains }, select: { id: true } }),
          prisma.tier.findMany({ where: { programId: request.programId, name: contains }, select: { id: true } }),
          prisma.badge.findMany({ where: { programId: request.programId, name: contains }, select: { id: true } }),
          prisma.eventDefinition.findMany({ where: { programId: request.programId, OR: [{ name: contains }, { key: contains }] }, select: { id: true } }),
          prisma.approvalWorkflow.findMany({ where: { programId: request.programId, OR: [{ name: contains }, { actionKey: contains }] }, select: { id: true } }),
          prisma.approvalRequest.findMany({ where: { programId: request.programId, OR: [{ actionKey: contains }, { subjectType: contains }] }, select: { id: true } }),
          prisma.pointTypeDefinition.findMany({ where: { programId: request.programId, OR: [{ name: contains }, { code: contains }] }, select: { id: true } }),
          prisma.pointBankCycle.findMany({
            where: { programId: request.programId, pointType: { is: { OR: [{ name: contains }, { code: contains }] } } },
            select: { id: true },
          }),
          prisma.member.findMany({
            where: { programId: request.programId, OR: [{ firstName: contains }, { lastName: contains }, { email: contains }] },
            select: { id: true },
          }),
        ]);
        const grouped: Array<[string, Array<{ id: string }>]> = [
          ["campaign", campaigns], ["coupon", coupons], ["reward", rewards], ["segment", segments], ["tier", tiers],
          ["badge", badges], ["event_definition", events], ["approval_workflow", workflows],
          ["approval_request", approvalRequests], ["point_type_definition", pointTypes], ["point_bank_cycle", cycles],
        ];
        const matches: Prisma.AuditLogWhereInput[] = grouped.flatMap(([entityType, rows]) => rows.length
          ? [{ entityType, entityId: { in: rows.map((row) => row.id) } }]
          : []);
        const memberIds = members.map((member) => member.id);
        if (memberIds.length) {
          matches.push({ entityType: { in: ["member", "member_credentials", "member_external_identity"] }, entityId: { in: memberIds } });
          matches.push(...memberIds.map((memberId) => ({ diff: { path: ["memberId"], string_contains: memberId } })));
        }
        return matches;
      };
      const targetMatches = search ? await targetMatchesFor(search) : [];

      const filters: Prisma.AuditLogWhereInput[] = [];
      if (actorSearch) {
        filters.push({
          OR: [
            { actorId: { contains: actorSearch, mode: "insensitive" } },
            ...(identityIdsByTerm.get(actorSearch)?.length ? [{ actorId: { in: identityIdsByTerm.get(actorSearch) } }] : []),
          ],
        });
      }
      if (search) {
        filters.push({
          OR: [
            { actorId: { contains: search, mode: "insensitive" } },
            { entityType: { contains: search, mode: "insensitive" } },
            { entityId: { contains: search, mode: "insensitive" } },
            { reason: { contains: search, mode: "insensitive" } },
            ...(identityIdsByTerm.get(search)?.length ? [{ actorId: { in: identityIdsByTerm.get(search) } }] : []),
            ...targetMatches,
            ...searchableDiffFields.map((field) => ({
              diff: { path: [field], string_contains: search },
            })),
          ],
        });
      }

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
        ...(filters.length ? { AND: filters } : {}),
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
      const targetMemberIds = items.flatMap((item) => {
        const diff = item.diff && typeof item.diff === "object" && !Array.isArray(item.diff)
          ? item.diff as Record<string, unknown>
          : {};
        const ids = typeof diff.memberId === "string" ? [diff.memberId] : [];
        if (["member", "member_credentials", "member_external_identity"].includes(item.entityType) && item.entityId) {
          ids.push(item.entityId);
        }
        return ids;
      });
      const memberIds = [...new Set([
        ...items.filter((item) => item.actorType === "MEMBER").map((item) => item.actorId),
        ...targetMemberIds,
      ])];
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

      const idsFor = (entityType: string): string[] => [...new Set(
        items.filter((item) => item.entityType === entityType && item.entityId).map((item) => item.entityId!),
      )];
      const [campaigns, cycles, rewards, segments, tiers, events, workflows, approvalRequests, coupons, badges, pointTypes] = await Promise.all([
        prisma.campaign.findMany({ where: { programId: request.programId, id: { in: idsFor("campaign") } }, select: { id: true, name: true } }),
        prisma.pointBankCycle.findMany({ where: { programId: request.programId, id: { in: idsFor("point_bank_cycle") } }, include: { pointType: { select: { code: true, name: true } } } }),
        prisma.reward.findMany({ where: { programId: request.programId, id: { in: idsFor("reward") } }, select: { id: true, name: true } }),
        prisma.segment.findMany({ where: { programId: request.programId, id: { in: idsFor("segment") } }, select: { id: true, name: true } }),
        prisma.tier.findMany({ where: { programId: request.programId, id: { in: idsFor("tier") } }, select: { id: true, name: true } }),
        prisma.eventDefinition.findMany({ where: { programId: request.programId, id: { in: idsFor("event_definition") } }, select: { id: true, name: true, key: true } }),
        prisma.approvalWorkflow.findMany({ where: { programId: request.programId, id: { in: idsFor("approval_workflow") } }, select: { id: true, name: true, actionKey: true } }),
        prisma.approvalRequest.findMany({ where: { programId: request.programId, id: { in: idsFor("approval_request") } }, select: { id: true, actionKey: true, status: true, subjectType: true } }),
        prisma.coupon.findMany({ where: { programId: request.programId, id: { in: idsFor("coupon") } }, select: { id: true, code: true } }),
        prisma.badge.findMany({ where: { programId: request.programId, id: { in: idsFor("badge") } }, select: { id: true, name: true } }),
        prisma.pointTypeDefinition.findMany({ where: { programId: request.programId, id: { in: idsFor("point_type_definition") } }, select: { id: true, name: true, code: true } }),
      ]);
      const campaignById = new Map(campaigns.map((item) => [item.id, item.name]));
      const cycleById = new Map(cycles.map((item) => [item.id, item]));
      const rewardById = new Map(rewards.map((item) => [item.id, item.name]));
      const segmentById = new Map(segments.map((item) => [item.id, item.name]));
      const tierById = new Map(tiers.map((item) => [item.id, item.name]));
      const eventById = new Map(events.map((item) => [item.id, `${item.name} · ${item.key}`]));
      const workflowById = new Map(workflows.map((item) => [item.id, `${item.name} · ${item.actionKey}`]));
      const approvalById = new Map(approvalRequests.map((item) => [item.id, `${item.actionKey} · ${item.subjectType} · ${item.status}`]));
      const couponById = new Map(coupons.map((item) => [item.id, item.code]));
      const badgeById = new Map(badges.map((item) => [item.id, item.name]));
      const pointTypeById = new Map(pointTypes.map((item) => [item.id, `${item.name} · ${item.code}`]));

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

      const targetLabel = (item: (typeof items)[number]): string | null => {
        if (!item.entityId) return null;
        if (item.entityType === "campaign") return campaignById.get(item.entityId) ?? null;
        if (item.entityType === "coupon") return couponById.get(item.entityId) ?? null;
        if (item.entityType === "reward") return rewardById.get(item.entityId) ?? null;
        if (item.entityType === "badge") return badgeById.get(item.entityId) ?? null;
        if (item.entityType === "point_type_definition") return pointTypeById.get(item.entityId) ?? null;
        if (item.entityType === "segment") return segmentById.get(item.entityId) ?? null;
        if (item.entityType === "tier") return tierById.get(item.entityId) ?? null;
        if (item.entityType === "event_definition") return eventById.get(item.entityId) ?? null;
        if (item.entityType === "approval_workflow") return workflowById.get(item.entityId) ?? null;
        if (item.entityType === "approval_request") return approvalById.get(item.entityId) ?? null;
        if (item.entityType === "point_bank_cycle") {
          const cycle = cycleById.get(item.entityId);
          if (!cycle) return null;
          const dates = `${cycle.startsAt.toISOString().slice(0, 10)} – ${cycle.endsAt.toISOString().slice(0, 10)}`;
          return `${cycle.pointType.code} · ${dates}`;
        }
        const diff = item.diff && typeof item.diff === "object" && !Array.isArray(item.diff)
          ? item.diff as Record<string, unknown>
          : {};
        const memberId = typeof diff.memberId === "string"
          ? diff.memberId
          : ["member", "member_credentials", "member_external_identity"].includes(item.entityType)
            ? item.entityId
            : null;
        const member = memberId ? memberById.get(memberId) : undefined;
        if (!member) return null;
        const name = [member.firstName, member.lastName].filter(Boolean).join(" ");
        return [name || null, member.email].filter(Boolean).join(" · ") || null;
      };

      return reply.send({
        data: {
          items: items.map((item) => ({
            ...item,
            actor: actorDetails(item.actorType, item.actorId),
            targetLabel: targetLabel(item),
          })),
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
