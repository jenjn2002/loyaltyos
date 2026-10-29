import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { createApprovalRequestWithClient } from "../../lib/approval-workflows.js";
import { audit } from "../../lib/audit.js";
import { createAdminActivityNotification, notifyApprovalAssignees } from "../../lib/admin-notifications.js";
import { adminRole, configuredVisibleValues, validateConfiguredValues } from "../../lib/customization.js";
import { LoyaltyError } from "../../lib/errors.js";
import { notificationsService } from "../../lib/notifications-setup.js";
import { assertCapability, requireCapability, type AdminCapability } from "../../lib/permissions.js";
import { walletService } from "../../lib/wallets.js";

const fieldSchema = z.object({
  key: z.string().trim().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(120),
  type: z.enum(["TEXT", "NUMBER", "BOOLEAN", "DATE", "SELECT"]).default("TEXT"),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});
const projectSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5000).nullable().optional(),
  fieldValues: z.record(z.unknown()).default({}),
  budgets: z.array(z.object({ pointTypeId: z.string().min(1), amount: z.number().int().positive() })).min(1).max(30),
});
const allocationSchema = z.object({
  memberId: z.string().min(1),
  pointTypeId: z.string().min(1),
  mode: z.enum(["AMOUNT", "PERCENT"]),
  value: z.number().positive(),
});
const evidenceItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("LINK"),
    url: z.string().trim().min(1).max(2048).url().refine((value) => {
      try {
        const parsed = new URL(value);
        return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password;
      } catch {
        return false;
      }
    }),
    name: z.string().trim().min(1).max(160).optional(),
  }),
  z.object({
    kind: z.literal("FILE"),
    attachmentId: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(160).optional(),
  }),
]);
const issueEvidenceSchema = z.array(evidenceItemSchema).max(10).default([]);

function json(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function currentAdmin(request: { adminId: string | null }): string {
  if (!request.adminId) throw new LoyaltyError("ADMIN_SESSION_REQUIRED", 403);
  return request.adminId;
}

async function ownedProject(programId: string, adminId: string, id: string) {
  const project = await prisma.project.findFirst({ where: { id, programId, createdByAdminId: adminId } });
  if (!project) throw new LoyaltyError("PROJECT_NOT_FOUND", 404);
  return project;
}

async function hasCapability(request: Parameters<typeof assertCapability>[0], capability: AdminCapability): Promise<boolean> {
  try {
    await assertCapability(request, capability);
    return true;
  } catch (error) {
    if (error instanceof LoyaltyError && error.httpStatus === 403) return false;
    throw error;
  }
}

function projectAccessFlags(
  request: { adminId: string | null },
  createdByAdminId: string,
  canManageProjects: boolean,
  canViewProjectFinance: boolean,
): { canManage: boolean; canViewBudget: boolean } {
  const isProjectManager = Boolean(request.adminId && request.adminId === createdByAdminId);
  return {
    canManage: isProjectManager && canManageProjects,
    canViewBudget: isProjectManager || canViewProjectFinance,
  };
}

type ProjectApprovalSummary = {
  id: string;
  status: string;
  requestedAt: Date;
  resolvedAt: Date | null;
  decision: string | null;
  comment: string | null;
};

function approvalSummary(request: {
  id: string;
  status: string;
  requestedAt: Date;
  resolvedAt: Date | null;
  resolutionComment: string | null;
  decisions: { decision: string; comment: string | null }[];
}): ProjectApprovalSummary {
  return {
    id: request.id,
    status: request.status,
    requestedAt: request.requestedAt,
    resolvedAt: request.resolvedAt,
    decision: request.decisions[0]?.decision ?? null,
    comment: request.resolutionComment ?? request.decisions[0]?.comment ?? null,
  };
}

async function validateFieldValues(
  programId: string,
  values: Record<string, unknown>,
  previousValues: Record<string, unknown> = {},
) {
  const definitions = await prisma.projectFieldDefinition.findMany({
    where: { programId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const byKey = new Map(definitions.map((field) => [field.key, field]));
  for (const [key, value] of Object.entries(values)) {
    const field = byKey.get(key);
    if (!field) throw new LoyaltyError("PROJECT_FIELD_UNKNOWN", 400);
    if (!field.isActive) {
      if (!(key in previousValues) || JSON.stringify(previousValues[key]) !== JSON.stringify(value)) {
        throw new LoyaltyError("PROJECT_FIELD_ARCHIVED", 400, { field: key });
      }
    }
  }
  for (const field of definitions.filter((item) => item.isActive)) {
    const value = values[field.key];
    if ((value === undefined || value === null || value === "") && field.required)
      throw new LoyaltyError("PROJECT_FIELD_REQUIRED", 400, { field: field.label });
    if (value === undefined || value === null || value === "") continue;
    if (field.type === "TEXT" && typeof value !== "string") throw new LoyaltyError("PROJECT_FIELD_VALUE_INVALID", 400);
    if (field.type === "NUMBER" && (typeof value !== "number" || !Number.isFinite(value))) throw new LoyaltyError("PROJECT_FIELD_VALUE_INVALID", 400);
    if (field.type === "BOOLEAN" && typeof value !== "boolean") throw new LoyaltyError("PROJECT_FIELD_VALUE_INVALID", 400);
    if (field.type === "DATE" && (typeof value !== "string" || Number.isNaN(Date.parse(value)))) throw new LoyaltyError("PROJECT_FIELD_VALUE_INVALID", 400);
    if (field.type === "SELECT" && (!Array.isArray(field.options) || !field.options.includes(value))) throw new LoyaltyError("PROJECT_FIELD_VALUE_INVALID", 400);
  }
}

async function syncBudgets(programId: string, projectId: string, budgets: { pointTypeId: string; amount: number }[]) {
  const ids = [...new Set(budgets.map((item) => item.pointTypeId))];
  if (ids.length !== budgets.length) throw new LoyaltyError("PROJECT_BUDGET_DUPLICATE_POINT_TYPE", 400);
  const types = await prisma.pointTypeDefinition.findMany({
    where: { id: { in: ids }, programId, isActive: true, archivedAt: null },
    select: { id: true, bankEnabled: true },
  });
  if (types.length !== ids.length || types.some((type) => !type.bankEnabled))
    throw new LoyaltyError("PROJECT_POINT_TYPE_REQUIRES_ACTIVE_BANK", 400);
  const wanted = new Set(ids);
  await prisma.$transaction(async (tx) => {
    for (const item of budgets) {
      await tx.projectPointBudget.upsert({
        where: { projectId_pointTypeId: { projectId, pointTypeId: item.pointTypeId } },
        create: { projectId, pointTypeId: item.pointTypeId, requestedAmount: item.amount, approvedAmount: 0, remainingAmount: 0 },
        update: { requestedAmount: item.amount },
      });
    }
    const current = await tx.projectPointBudget.findMany({ where: { projectId }, select: { id: true, pointTypeId: true } });
    const remove = current.filter((item) => !wanted.has(item.pointTypeId)).map((item) => item.id);
    if (remove.length) await tx.projectPointBudget.deleteMany({ where: { id: { in: remove } } });
  });
}

export function adminProjectsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get("/admin/project-fields", { preHandler: [requireCapability("project.view")] }, async (request, reply) => {
    return reply.send({ data: await prisma.projectFieldDefinition.findMany({ where: { programId: request.programId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }) });
  });
  app.post("/admin/project-fields", { preHandler: [requireCapability("project.manage")] }, async (request, reply) => {
    const body = fieldSchema.parse(request.body);
    if (body.type === "SELECT" && !body.options.length) throw new LoyaltyError("PROJECT_FIELD_OPTIONS_REQUIRED", 400);
    const field = await prisma.projectFieldDefinition.create({ data: { ...body, programId: request.programId, options: body.options as unknown as Prisma.InputJsonValue } });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project_field", field.id, { key: field.key, type: field.type });
    return reply.status(201).send({ data: field });
  });
  app.patch("/admin/project-fields/:id", { preHandler: [requireCapability("project.manage")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = fieldSchema.partial().parse(request.body);
    const existing = await prisma.projectFieldDefinition.findFirst({ where: { id, programId: request.programId } });
    if (!existing) throw new LoyaltyError("PROJECT_FIELD_NOT_FOUND", 404);
    const type = body.type ?? existing.type;
    const options = body.options ?? (Array.isArray(existing.options) ? existing.options.filter((value): value is string => typeof value === "string") : []);
    if (type === "SELECT" && !options.length) throw new LoyaltyError("PROJECT_FIELD_OPTIONS_REQUIRED", 400);
    const field = await prisma.projectFieldDefinition.update({ where: { id }, data: { ...body, options: body.options ? body.options as unknown as Prisma.InputJsonValue : undefined } });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project_field", id, body);
    return reply.send({ data: field });
  });
  app.delete("/admin/project-fields/:id", { preHandler: [requireCapability("project.manage")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const field = await prisma.projectFieldDefinition.findFirst({ where: { id, programId: request.programId } });
    if (!field) throw new LoyaltyError("PROJECT_FIELD_NOT_FOUND", 404);
    await prisma.projectFieldDefinition.update({ where: { id }, data: { isActive: false } });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project_field", id, { archived: true });
    return reply.status(204).send();
  });

  app.get("/admin/projects/bootstrap", { preHandler: [requireCapability("project.view")] }, async (request, reply) => {
    let canViewBankBalances = true;
    let canManageProjects = true;
    let canViewMembers = true;
    try {
      await assertCapability(request, "bank.view");
    } catch (error) {
      if (!(error instanceof LoyaltyError) || error.httpStatus !== 403) throw error;
      canViewBankBalances = false;
    }
    try {
      await assertCapability(request, "project.manage");
    } catch (error) {
      if (!(error instanceof LoyaltyError) || error.httpStatus !== 403) throw error;
      canManageProjects = false;
    }
    try {
      await assertCapability(request, "member.view");
    } catch (error) {
      if (!(error instanceof LoyaltyError) || error.httpStatus !== 403) throw error;
      canViewMembers = false;
    }
    const [fields, pointTypes, members] = await Promise.all([
      prisma.projectFieldDefinition.findMany({ where: { programId: request.programId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
      prisma.pointTypeDefinition.findMany({ where: { programId: request.programId, isActive: true, archivedAt: null, bankEnabled: true }, include: { banks: { where: { programId: request.programId }, select: { balance: true } } }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
      canViewMembers ? prisma.member.findMany({ where: { programId: request.programId, deletedAt: null, status: "ACTIVE" }, select: { id: true, email: true, firstName: true, lastName: true, department: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 1000 }) : Promise.resolve([]),
    ]);
    return reply.send({ data: { fields: canManageProjects ? fields : [], canManageProjects, pointTypes: pointTypes.map(({ banks, ...type }) => ({ ...type, bankBalance: canViewBankBalances ? banks[0]?.balance ?? 0 : null })), members } });
  });
  app.get("/admin/projects", { preHandler: [requireCapability("project.view")] }, async (request, reply) => {
    const [canManageProjects, canViewProjectFinance] = await Promise.all([
      hasCapability(request, "project.manage"),
      hasCapability(request, "project.finance.view"),
    ]);
    const data = await prisma.project.findMany({
      where: { programId: request.programId },
      include: { createdBy: { select: { id: true, name: true, email: true } }, budgets: { include: { pointType: { select: { code: true, name: true } } } }, _count: { select: { members: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return reply.send({ data: data.map((project) => {
      const flags = projectAccessFlags(request, project.createdByAdminId, canManageProjects, canViewProjectFinance);
      return {
        ...project,
        fieldValues: flags.canViewBudget ? project.fieldValues : {},
        budgets: flags.canViewBudget ? project.budgets : [],
        ...flags,
      };
    }) });
  });
  app.post("/admin/projects", { preHandler: [requireCapability("project.manage")] }, async (request, reply) => {
    const body = projectSchema.parse(request.body);
    const adminId = currentAdmin(request);
    await validateFieldValues(request.programId, body.fieldValues);
    const project = await prisma.project.create({ data: { programId: request.programId, createdByAdminId: adminId, name: body.name, description: body.description ?? null, fieldValues: json(body.fieldValues) } });
    try {
      await syncBudgets(request.programId, project.id, body.budgets);
    } catch (error) {
      await prisma.project.delete({ where: { id: project.id } });
      throw error;
    }
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project", project.id, { operation: "CREATE", name: project.name, budgetLines: body.budgets.length });
    return reply.status(201).send({ data: project });
  });
  app.get("/admin/projects/:id", { preHandler: [requireCapability("project.view")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const access = await prisma.project.findFirst({
      where: { id, programId: request.programId },
      select: { id: true, createdByAdminId: true },
    });
    if (!access) throw new LoyaltyError("PROJECT_NOT_FOUND", 404);
    const [canManageProjects, canViewProjectFinance] = await Promise.all([
      hasCapability(request, "project.manage"),
      hasCapability(request, "project.finance.view"),
    ]);
    const flags = projectAccessFlags(request, access.createdByAdminId, canManageProjects, canViewProjectFinance);
    const project = await prisma.project.findFirst({
      where: { id, programId: request.programId },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        budgets: flags.canViewBudget ? { include: { pointType: { select: { code: true, name: true, unitLabel: true } } } } : false,
        members: { include: { member: { select: { id: true, email: true, firstName: true, lastName: true, department: true } } }, orderBy: { invitedAt: "desc" } },
        issueBatches: flags.canViewBudget ? { include: { allocations: { include: { member: { select: { id: true, email: true, firstName: true, lastName: true } }, pointType: { select: { code: true, name: true } } } } }, orderBy: { createdAt: "desc" } } : false,
        budgetTransactions: flags.canViewBudget ? { include: { pointType: { select: { code: true, name: true } } }, orderBy: { createdAt: "desc" } } : false,
      },
    });
    if (!project) throw new LoyaltyError("PROJECT_NOT_FOUND", 404);
    const issueBatches = flags.canViewBudget && project.issueBatches.length
      ? await (async () => {
          const role = await adminRole(request);
          return Promise.all(project.issueBatches.map(async (batch) => ({
            ...batch,
            fieldValues: await configuredVisibleValues(request.programId, "PROJECT_DISTRIBUTION", batch.fieldValues, role),
          })));
        })()
      : flags.canViewBudget ? project.issueBatches : [];
    const projectApprovalSummary = flags.canViewBudget
      ? await (async () => {
          const batchIds = project.issueBatches.map((batch) => batch.id);
          const approvals = await prisma.approvalRequest.findMany({
            where: {
              programId: request.programId,
              OR: [
                { actionKey: "PROJECT_PLAN_APPROVAL", subjectType: "Project", subjectId: id },
                ...(batchIds.length ? [{ actionKey: "PROJECT_POINT_ISSUANCE", subjectType: "ProjectIssueBatch", subjectId: { in: batchIds } }] : []),
              ],
            },
            select: {
              id: true,
              actionKey: true,
              status: true,
              requestedAt: true,
              resolvedAt: true,
              resolutionComment: true,
              decisions: { orderBy: { createdAt: "desc" }, take: 1, select: { decision: true, comment: true } },
            },
            orderBy: { requestedAt: "desc" },
          });
          const plan = approvals.find((item) => item.actionKey === "PROJECT_PLAN_APPROVAL");
          const distribution = approvals.find((item) => item.actionKey === "PROJECT_POINT_ISSUANCE");
          return {
            plan: plan ? approvalSummary(plan) : null,
            distribution: distribution ? approvalSummary(distribution) : null,
          };
        })()
      : null;
    return reply.send({ data: {
      ...project,
      fieldValues: flags.canViewBudget ? project.fieldValues : {},
      budgets: flags.canViewBudget ? project.budgets : [],
      issueBatches,
      budgetTransactions: flags.canViewBudget ? project.budgetTransactions : [],
      ...flags,
      approvalSummary: projectApprovalSummary,
    } });
  });
  app.patch("/admin/projects/:id", { preHandler: [requireCapability("project.manage")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = projectSchema.parse(request.body);
    const existing = await ownedProject(request.programId, currentAdmin(request), id);
    if (!["DRAFT", "PLAN_REJECTED"].includes(existing.status)) throw new LoyaltyError("PROJECT_PLAN_LOCKED", 409);
    await validateFieldValues(request.programId, body.fieldValues, jsonRecord(existing.fieldValues));
    await syncBudgets(request.programId, id, body.budgets);
    const project = await prisma.project.update({ where: { id }, data: { name: body.name, description: body.description ?? null, fieldValues: json(body.fieldValues) } });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project", id, { operation: "UPDATE", name: body.name, before: { name: existing.name, description: existing.description }, after: { name: project.name, description: project.description } });
    return reply.send({ data: project });
  });
  app.post("/admin/projects/:id/submit-plan", { preHandler: [requireCapability("project.manage")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const adminId = currentAdmin(request);
    const result = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({ where: { id, programId: request.programId, createdByAdminId: adminId }, include: { budgets: { include: { pointType: { select: { code: true, name: true } } } } } });
      if (!project) throw new LoyaltyError("PROJECT_NOT_FOUND", 404);
      if (!["DRAFT", "PLAN_REJECTED"].includes(project.status)) throw new LoyaltyError("PROJECT_PLAN_NOT_SUBMITTABLE", 409);
      if (!project.budgets.length || project.budgets.some((budget) => budget.requestedAmount <= 0)) throw new LoyaltyError("PROJECT_BUDGET_REQUIRED", 400);
      const total = project.budgets.reduce((sum, budget) => sum + budget.requestedAmount, 0);
      const approval = await createApprovalRequestWithClient(tx, {
        programId: request.programId, actionKey: "PROJECT_PLAN_APPROVAL", requestedByType: "ADMIN_USER", requestedById: adminId, requesterAdminId: adminId,
        subjectType: "Project", subjectId: project.id,
        idempotencyKey: `project-plan:${project.id}:${project.updatedAt.toISOString()}`,
        payload: { projectName: project.name, description: project.description, fieldValues: project.fieldValues, requestedBudgets: project.budgets.map((budget) => ({ pointTypeId: budget.pointTypeId, code: budget.pointType.code, pointType: budget.pointType.name, amount: budget.requestedAmount })) } as Prisma.InputJsonValue,
        scopeContext: { amount: total },
      });
      if (!approval) throw new LoyaltyError("PROJECT_PLAN_WORKFLOW_NOT_CONFIGURED", 409);
      await tx.project.update({ where: { id }, data: { status: "PLAN_PENDING" } });
      return approval;
    });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project", id, { operation: "SUBMIT_PLAN", approvalRequestId: result.id });
    await notifyApprovalAssignees(request.programId, result.id).catch((error: unknown) => request.log.warn({ err: error, approvalRequestId: result.id }, "Failed to notify project-plan approvers"));
    return reply.status(201).send({ data: result });
  });
  app.post("/admin/projects/:id/activate", { preHandler: [requireCapability("project.manage")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const project = await ownedProject(request.programId, currentAdmin(request), id);
    if (project.status !== "APPROVED") throw new LoyaltyError("PROJECT_NOT_READY_TO_ACTIVATE", 409);
    const updated = await prisma.project.update({ where: { id }, data: { status: "ACTIVE", activatedAt: new Date() } });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project", id, { operation: "ACTIVATE" });
    return reply.send({ data: updated });
  });
  app.post("/admin/projects/:id/members", { preHandler: [requireCapability("project.manage")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ memberIds: z.array(z.string().min(1)).min(1).max(500) }).parse(request.body);
    const adminId = currentAdmin(request);
    const project = await ownedProject(request.programId, adminId, id);
    if (project.status !== "ACTIVE") throw new LoyaltyError("PROJECT_NOT_ACTIVE", 409);
    const ids = [...new Set(body.memberIds)];
    const members = await prisma.member.findMany({ where: { id: { in: ids }, programId: request.programId, deletedAt: null, status: "ACTIVE" }, select: { id: true, email: true, phone: true, firstName: true, lastName: true, locale: true, program: { select: { defaultLocale: true } } } });
    if (members.length !== ids.length) throw new LoyaltyError("PROJECT_MEMBER_NOT_FOUND", 404);
    let invited = 0;
    const invitedMemberIds: string[] = [];
    for (const member of members) {
      const existingMembership = await prisma.projectMember.findUnique({
        where: { projectId_memberId: { projectId: id, memberId: member.id } },
        select: { status: true },
      });
      if (existingMembership?.status === "ACCEPTED" || existingMembership?.status === "INVITED") continue;
      const invitation = await prisma.projectMember.upsert({ where: { projectId_memberId: { projectId: id, memberId: member.id } }, create: { projectId: id, memberId: member.id, invitedByAdminId: adminId }, update: { status: "INVITED", invitedByAdminId: adminId, invitedAt: new Date(), respondedAt: null } });
      const prior = await prisma.notification.findFirst({ where: { memberId: member.id, channel: "IN_APP", metadata: { path: ["projectInvitationId"], equals: invitation.id }, createdAt: { gte: invitation.invitedAt } }, select: { id: true } });
      if (!prior) {
        await notificationsService.sendTrigger(request.programId, "project.invitation", member.id, {
          member,
          project: { id, name: project.name },
          projectInvitationId: invitation.id,
          _locale: member.locale ?? member.program.defaultLocale ?? "vi-VN",
        }).catch((error: unknown) => request.log.warn({ err: error, projectId: id, memberId: member.id }, "Failed to notify project invitation"));
      }
      invited += 1;
      invitedMemberIds.push(member.id);
    }
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project", id, { operation: "INVITE_MEMBERS", name: project.name, memberCount: invited, memberIds: invitedMemberIds });
    return reply.status(201).send({ data: { invited } });
  });
  app.post("/admin/projects/:id/complete", { preHandler: [requireCapability("project.manage")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const project = await ownedProject(request.programId, currentAdmin(request), id);
    if (project.status !== "ACTIVE") throw new LoyaltyError("PROJECT_NOT_ACTIVE", 409);
    const transition = await prisma.project.updateMany({
      where: { id, programId: request.programId, createdByAdminId: currentAdmin(request), status: "ACTIVE" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    if (transition.count !== 1) throw new LoyaltyError("PROJECT_NOT_ACTIVE", 409);
    const updated = await prisma.project.findFirstOrThrow({ where: { id, programId: request.programId } });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project", id, { operation: "CONFIRM_COMPLETION" });
    const recipients = await prisma.projectMember.findMany({
      where: { projectId: id, status: "ACCEPTED", member: { deletedAt: null, status: "ACTIVE" } },
      include: { member: { select: { id: true, email: true, phone: true, firstName: true, lastName: true, locale: true, program: { select: { defaultLocale: true } } } } },
    });
    const completionNotices = await Promise.allSettled(recipients.map(({ member }) => notificationsService.sendTrigger(request.programId, "project.completed", member.id, {
      member,
      project: { id, name: project.name },
      _locale: member.locale ?? member.program.defaultLocale ?? "vi-VN",
    })));
    completionNotices.forEach((result) => {
      if (result.status === "rejected") request.log.warn({ err: result.reason, projectId: id }, "Failed to notify project member of completion");
    });
    return reply.send({ data: updated });
  });
  app.post("/admin/projects/:id/submit-issuance", { preHandler: [requireCapability("project.manage")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({
      allocations: z.array(allocationSchema).min(1).max(10000),
      description: z.string().trim().max(5000).optional(),
      evidence: issueEvidenceSchema,
      fieldValues: z.record(z.unknown()).optional().default({}),
    }).parse(request.body);
    const adminId = currentAdmin(request);
    await ownedProject(request.programId, adminId, id);
    const role = await adminRole(request);
    const safeFieldValues = await validateConfiguredValues(request.programId, "PROJECT_DISTRIBUTION", body.fieldValues, { role, adminId, projectId: id });
    const approvalFieldValues = await configuredVisibleValues(request.programId, "PROJECT_DISTRIBUTION", safeFieldValues, role, true);
    const result = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({ where: { id, programId: request.programId, createdByAdminId: adminId }, include: { budgets: { include: { pointType: { select: { code: true, name: true } } } }, members: { where: { status: "ACCEPTED" }, include: { member: { select: { id: true, email: true, firstName: true, lastName: true } } } } } });
      if (!project) throw new LoyaltyError("PROJECT_NOT_FOUND", 404);
      if (!["COMPLETED", "ISSUE_REJECTED"].includes(project.status)) throw new LoyaltyError("PROJECT_NOT_COMPLETE", 409);
      const currentBatch = await tx.projectIssueBatch.findFirst({ where: { projectId: id, status: "PENDING" } });
      if (currentBatch) throw new LoyaltyError("PROJECT_ISSUANCE_PENDING", 409);
      const attachmentIds = [...new Set(body.evidence.flatMap((item) => item.kind === "FILE" ? [item.attachmentId] : []))];
      const attachmentNames = new Map<string, string>();
      if (attachmentIds.length) {
        const attachments = await tx.customAttachment.findMany({
          where: { id: { in: attachmentIds }, programId: request.programId, contextType: "PROJECT", contextId: id, uploadedByAdminId: adminId },
          select: { id: true, name: true },
        });
        if (attachments.length !== attachmentIds.length) throw new LoyaltyError("PROJECT_EVIDENCE_ATTACHMENT_INVALID", 400);
        for (const attachment of attachments) attachmentNames.set(attachment.id, attachment.name);
      }
      const membership = new Map(project.members.map((item) => [item.memberId, item.member]));
      const budgetByType = new Map(project.budgets.map((item) => [item.pointTypeId, item]));
      const seen = new Set<string>();
      const normalized: { memberId: string; pointTypeId: string; amount: number; budgetId: string; member: { id: string; email: string | null; firstName: string | null; lastName: string | null }; code: string; name: string }[] = [];
      const totals = new Map<string, number>();
      for (const line of body.allocations) {
        const key = `${line.memberId}:${line.pointTypeId}`;
        if (seen.has(key)) throw new LoyaltyError("PROJECT_ALLOCATION_DUPLICATE", 400);
        seen.add(key);
        const member = membership.get(line.memberId);
        const budget = budgetByType.get(line.pointTypeId);
        if (!member || !budget) throw new LoyaltyError("PROJECT_ALLOCATION_TARGET_INVALID", 400);
        if (line.mode === "PERCENT" && line.value > 100) throw new LoyaltyError("PROJECT_ALLOCATION_PERCENT_INVALID", 400);
        const amount = line.mode === "AMOUNT" ? line.value : Math.floor(budget.approvedAmount * line.value / 100);
        if (!Number.isSafeInteger(amount) || amount <= 0) throw new LoyaltyError("PROJECT_ALLOCATION_AMOUNT_INVALID", 400);
        totals.set(line.pointTypeId, (totals.get(line.pointTypeId) ?? 0) + amount);
        normalized.push({ memberId: member.id, pointTypeId: line.pointTypeId, amount, budgetId: budget.id, member, code: budget.pointType.code, name: budget.pointType.name });
      }
      for (const [pointTypeId, amount] of totals) {
        const budget = budgetByType.get(pointTypeId)!;
        if (amount > budget.remainingAmount) throw new LoyaltyError("PROJECT_ALLOCATION_EXCEEDS_REMAINING_BUDGET", 400, { pointType: budget.pointType.code, available: budget.remainingAmount, requested: amount });
      }
      const description = body.description?.trim() || null;
      const evidenceReferences = body.evidence.map((item) => {
        if (item.kind === "LINK") return { kind: item.kind, url: item.url, ...(item.name ? { name: item.name } : {}) };
        const name = item.name ?? attachmentNames.get(item.attachmentId);
        return { kind: item.kind, attachmentId: item.attachmentId, ...(name ? { name } : {}) };
      });
      const batch = await tx.projectIssueBatch.create({
        data: {
          projectId: id,
          status: "DRAFT",
          submittedByAdminId: adminId,
          description,
          evidence: evidenceReferences as Prisma.InputJsonValue,
          fieldValues: json(safeFieldValues),
        },
      });
      await tx.projectGrantAllocation.createMany({ data: normalized.map((item) => ({ batchId: batch.id, projectId: id, budgetId: item.budgetId, memberId: item.memberId, pointTypeId: item.pointTypeId, amount: item.amount })) });
      const totalAmount = normalized.reduce((sum, item) => sum + item.amount, 0);
      const approval = await createApprovalRequestWithClient(tx, {
        programId: request.programId, actionKey: "PROJECT_POINT_ISSUANCE", requestedByType: "ADMIN_USER", requestedById: adminId, requesterAdminId: adminId,
        subjectType: "ProjectIssueBatch", subjectId: batch.id, idempotencyKey: `project-issue:${batch.id}`,
        payload: { projectId: id, projectName: project.name, totalAmount, description, evidence: evidenceReferences, fieldValues: approvalFieldValues, allocations: normalized.map((item) => ({ member: [item.member.firstName, item.member.lastName].filter(Boolean).join(" ") || item.member.email, email: item.member.email, pointType: item.name, pointTypeCode: item.code, amount: item.amount })) } as Prisma.InputJsonValue,
        scopeContext: { amount: totalAmount },
      });
      if (!approval) throw new LoyaltyError("PROJECT_ISSUANCE_WORKFLOW_NOT_CONFIGURED", 409);
      await tx.projectIssueBatch.update({ where: { id: batch.id }, data: { approvalRequestId: approval.id, status: "PENDING" } });
      await tx.project.update({ where: { id }, data: { status: "ISSUE_PENDING" } });
      return { approval, batchId: batch.id, totalAmount, description, evidenceReferences };
    });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project", id, {
      operation: "SUBMIT_ISSUANCE",
      issueBatchId: result.batchId,
      totalAmount: result.totalAmount,
      approvalRequestId: result.approval.id,
      evidenceReferences: result.evidenceReferences,
    });
    await notifyApprovalAssignees(request.programId, result.approval.id).catch((error: unknown) => request.log.warn({ err: error, approvalRequestId: result.approval.id }, "Failed to notify project-issuance approvers"));
    return reply.status(201).send({ data: result });
  });
  app.post("/admin/projects/:id/close", { preHandler: [requireCapability("project.manage")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const adminId = currentAdmin(request);
    const closed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${id} FOR UPDATE`;
      const project = await tx.project.findFirst({ where: { id, programId: request.programId, createdByAdminId: adminId }, include: { budgets: true } });
      if (!project) throw new LoyaltyError("PROJECT_NOT_FOUND", 404);
      if (!["COMPLETED", "ISSUED", "ISSUE_REJECTED"].includes(project.status)) throw new LoyaltyError("PROJECT_NOT_CLOSABLE", 409);
      for (const budget of project.budgets) {
        if (!budget.remainingAmount) continue;
        await walletService.returnProjectBudgetWithTransaction(tx, { programId: request.programId, pointTypeId: budget.pointTypeId, amount: budget.remainingAmount, projectId: id, actorId: adminId, idempotencyKey: `project:${id}:return:${budget.pointTypeId}` });
        await tx.projectBudgetTransaction.create({ data: { projectId: id, budgetId: budget.id, programId: request.programId, pointTypeId: budget.pointTypeId, type: "RETURNED", amount: -budget.remainingAmount, balanceAfter: 0, reason: "Project closed; unused budget returned to bank", actorId: adminId, idempotencyKey: `return:${budget.pointTypeId}` } });
        await tx.projectPointBudget.update({ where: { id: budget.id }, data: { remainingAmount: 0 } });
      }
      return tx.project.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() } });
    });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project", id, { operation: "CLOSE", returnedUnusedBudget: true });
    return reply.send({ data: closed });
  });

  app.get("/members/me/projects", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const memberships = await prisma.projectMember.findMany({
      where: { memberId: request.memberId, project: { programId: request.programId, status: { notIn: ["DRAFT", "PLAN_PENDING", "PLAN_REJECTED", "APPROVED"] } } },
      select: {
        id: true,
        projectId: true,
        status: true,
        invitedAt: true,
        respondedAt: true,
        project: {
          select: {
            id: true,
            name: true,
            description: true,
            status: true,
            activatedAt: true,
            completedAt: true,
            closedAt: true,
            updatedAt: true,
            createdBy: { select: { name: true } },
          },
        },
      },
      orderBy: { invitedAt: "desc" },
    });
    const acceptedProjectIds = [...new Set(memberships.filter((membership) => membership.status === "ACCEPTED").map((membership) => membership.projectId))];
    const acceptedParticipants = acceptedProjectIds.length
      ? await prisma.projectMember.findMany({
          where: {
            projectId: { in: acceptedProjectIds },
            status: "ACCEPTED",
            member: { programId: request.programId, deletedAt: null, status: "ACTIVE" },
          },
          select: { projectId: true, invitedAt: true, respondedAt: true, member: { select: { id: true, firstName: true, lastName: true, department: true, photoUrl: true } } },
        })
      : [];
    const participantsByProject = new Map<string, { memberId: string; name: string; department: string | null; photoUrl: string | null }[]>();
    const participantUpdatesByProject = new Map<string, Date[]>();
    for (const { projectId, member, invitedAt, respondedAt } of acceptedParticipants) {
      const participants = participantsByProject.get(projectId) ?? [];
      participants.push({
        memberId: member.id,
        name: [member.firstName, member.lastName].filter(Boolean).join(" ") || "Member",
        department: member.department,
        photoUrl: member.photoUrl,
      });
      participantsByProject.set(projectId, participants);
      const updates = participantUpdatesByProject.get(projectId) ?? [];
      updates.push(...[invitedAt, respondedAt].filter((value): value is Date => value !== null));
      participantUpdatesByProject.set(projectId, updates);
    }
    return reply.send({ data: memberships.map((membership) => ({
      id: membership.id,
      status: membership.status,
      invitedAt: membership.invitedAt,
      respondedAt: membership.respondedAt,
      project: {
        id: membership.project.id,
        name: membership.project.name,
        description: membership.project.description,
        status: membership.project.status,
        activatedAt: membership.project.activatedAt,
        completedAt: membership.project.completedAt,
        closedAt: membership.project.closedAt,
        informationUpdatedAt: [
          membership.project.updatedAt,
          membership.invitedAt,
          membership.respondedAt,
          ...(participantUpdatesByProject.get(membership.projectId) ?? []),
        ].filter((value): value is Date => value !== null)
          .reduce((latest, value) => value > latest ? value : latest)
          .toISOString(),
        projectManager: membership.project.createdBy ? { name: membership.project.createdBy.name } : null,
        ...(membership.status === "ACCEPTED" ? { members: participantsByProject.get(membership.projectId) ?? [] } : {}),
      },
    })) });
  });
  app.post("/members/me/projects/:id/respond", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { response } = z.object({ response: z.enum(["ACCEPTED", "DECLINED"]) }).parse(request.body);
    const membership = await prisma.projectMember.findFirst({ where: { projectId: id, memberId: request.memberId, project: { programId: request.programId, status: "ACTIVE" } }, include: { project: { select: { id: true, name: true, createdByAdminId: true } } } });
    if (!membership) throw new LoyaltyError("PROJECT_INVITATION_NOT_FOUND", 404);
    if (membership.status !== "INVITED") throw new LoyaltyError("PROJECT_INVITATION_ALREADY_ANSWERED", 409);
    const updated = await prisma.projectMember.update({ where: { id: membership.id }, data: { status: response, respondedAt: new Date() } });
    const member = await prisma.member.findUnique({ where: { id: request.memberId }, select: { email: true, firstName: true, lastName: true } });
    await createAdminActivityNotification({
      programId: request.programId,
      adminUserId: membership.project.createdByAdminId,
      triggerEvent: "admin.project.member_responded",
      idempotencyKey: `project-member-response:${updated.id}:${updated.respondedAt?.toISOString() ?? updated.status}`,
      title: response === "ACCEPTED" ? "Project invitation accepted" : "Project invitation declined",
      body: `${[member?.firstName, member?.lastName].filter(Boolean).join(" ") || member?.email || "A member"} ${response === "ACCEPTED" ? "accepted" : "declined"} the invitation to ${membership.project.name}.`,
      actionUrl: `/projects?project=${encodeURIComponent(id)}`,
      entityType: "Project",
      entityId: id,
      context: {
        member: { name: [member?.firstName, member?.lastName].filter(Boolean).join(" ") || member?.email || "Member", email: member?.email ?? "" },
        project: { id, name: membership.project.name },
        response: response.toLowerCase(),
      },
    }).catch((error: unknown) => request.log.warn({ err: error, projectId: id, memberId: request.memberId }, "Failed to notify project manager of invitation response"));
    await audit(request.programId, { type: "MEMBER", id: request.memberId }, "CONFIG_CHANGE", "project", id, {
      operation: "RESPOND_INVITATION", memberId: request.memberId,
      before: { status: membership.status }, after: { status: response },
    });
    return reply.send({ data: updated });
  });
  done();
}
