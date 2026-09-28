import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { createApprovalRequestWithClient } from "../../lib/approval-workflows.js";
import { audit } from "../../lib/audit.js";
import { LoyaltyError } from "../../lib/errors.js";
import { assertCapability, requireCapability } from "../../lib/permissions.js";
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
    const data = await prisma.project.findMany({
      where: { programId: request.programId },
      include: { createdBy: { select: { id: true, name: true, email: true } }, budgets: { include: { pointType: { select: { code: true, name: true } } } }, _count: { select: { members: true, tasks: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return reply.send({ data });
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
    const project = await prisma.project.findFirst({
      where: { id, programId: request.programId },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        budgets: { include: { pointType: { select: { code: true, name: true, unitLabel: true } } } },
        members: { include: { member: { select: { id: true, email: true, firstName: true, lastName: true, department: true } } }, orderBy: { invitedAt: "desc" } },
        tasks: { include: { assignee: { select: { id: true, email: true, firstName: true, lastName: true } } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
        issueBatches: { include: { allocations: { include: { member: { select: { id: true, email: true, firstName: true, lastName: true } }, pointType: { select: { code: true, name: true } } } } }, orderBy: { createdAt: "desc" } },
        budgetTransactions: { include: { pointType: { select: { code: true, name: true } } }, orderBy: { createdAt: "desc" } },
      },
    });
    if (!project) throw new LoyaltyError("PROJECT_NOT_FOUND", 404);
    return reply.send({ data: project });
  });
  app.patch("/admin/projects/:id", { preHandler: [requireCapability("project.manage")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = projectSchema.parse(request.body);
    const existing = await ownedProject(request.programId, currentAdmin(request), id);
    if (!["DRAFT", "PLAN_REJECTED"].includes(existing.status)) throw new LoyaltyError("PROJECT_PLAN_LOCKED", 409);
    await validateFieldValues(request.programId, body.fieldValues, jsonRecord(existing.fieldValues));
    await syncBudgets(request.programId, id, body.budgets);
    const project = await prisma.project.update({ where: { id }, data: { name: body.name, description: body.description ?? null, fieldValues: json(body.fieldValues) } });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project", id, { operation: "UPDATE", name: body.name });
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
    const members = await prisma.member.findMany({ where: { id: { in: ids }, programId: request.programId, deletedAt: null, status: "ACTIVE" }, select: { id: true } });
    if (members.length !== ids.length) throw new LoyaltyError("PROJECT_MEMBER_NOT_FOUND", 404);
    let invited = 0;
    for (const member of members) {
      const existingMembership = await prisma.projectMember.findUnique({
        where: { projectId_memberId: { projectId: id, memberId: member.id } },
        select: { status: true },
      });
      if (existingMembership?.status === "ACCEPTED" || existingMembership?.status === "INVITED") continue;
      const invitation = await prisma.projectMember.upsert({ where: { projectId_memberId: { projectId: id, memberId: member.id } }, create: { projectId: id, memberId: member.id, invitedByAdminId: adminId }, update: { status: "INVITED", invitedByAdminId: adminId, invitedAt: new Date(), respondedAt: null } });
      const prior = await prisma.notification.findFirst({ where: { memberId: member.id, metadata: { path: ["projectInvitationId"], equals: invitation.id }, status: { not: "READ" } }, select: { id: true } });
      if (!prior) await prisma.notification.create({ data: { memberId: member.id, channel: "IN_APP", subject: "Project invitation", body: `You are invited to join ${project.name}. Please review and respond in Projects.`, metadata: { projectInvitationId: invitation.id, projectId: id } } });
      invited += 1;
    }
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project", id, { operation: "INVITE_MEMBERS", memberCount: invited });
    return reply.status(201).send({ data: { invited } });
  });
  app.post("/admin/projects/:id/tasks", { preHandler: [requireCapability("project.manage")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ title: z.string().trim().min(1).max(160), description: z.string().trim().max(3000).optional(), assigneeId: z.string().nullable().optional(), dueAt: z.string().datetime().nullable().optional() }).parse(request.body);
    const project = await ownedProject(request.programId, currentAdmin(request), id);
    if (project.status !== "ACTIVE") throw new LoyaltyError("PROJECT_NOT_ACTIVE", 409);
    if (body.assigneeId) {
      const accepted = await prisma.projectMember.findFirst({ where: { projectId: id, memberId: body.assigneeId, status: "ACCEPTED" } });
      if (!accepted) throw new LoyaltyError("PROJECT_MEMBER_MUST_ACCEPT_FIRST", 409);
    }
    const task = await prisma.projectTask.create({ data: { projectId: id, title: body.title, description: body.description, assigneeId: body.assigneeId ?? null, dueAt: body.dueAt ? new Date(body.dueAt) : null } });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project_task", task.id, { operation: "CREATE", projectId: id, title: task.title });
    return reply.status(201).send({ data: task });
  });
  app.patch("/admin/projects/:id/tasks/:taskId", { preHandler: [requireCapability("project.manage")] }, async (request, reply) => {
    const { id, taskId } = z.object({ id: z.string().min(1), taskId: z.string().min(1) }).parse(request.params);
    const body = z.object({ title: z.string().trim().min(1).max(160).optional(), description: z.string().trim().max(3000).nullable().optional(), assigneeId: z.string().nullable().optional(), dueAt: z.string().datetime().nullable().optional(), status: z.enum(["TODO", "IN_PROGRESS", "DONE"]).optional() }).parse(request.body);
    const project = await ownedProject(request.programId, currentAdmin(request), id);
    if (project.status !== "ACTIVE") throw new LoyaltyError("PROJECT_NOT_ACTIVE", 409);
    const current = await prisma.projectTask.findFirst({ where: { id: taskId, projectId: id } });
    if (!current) throw new LoyaltyError("PROJECT_TASK_NOT_FOUND", 404);
    if (body.assigneeId) {
      const accepted = await prisma.projectMember.findFirst({ where: { projectId: id, memberId: body.assigneeId, status: "ACCEPTED" } });
      if (!accepted) throw new LoyaltyError("PROJECT_MEMBER_MUST_ACCEPT_FIRST", 409);
    }
    const task = await prisma.projectTask.update({ where: { id: taskId }, data: { ...body, dueAt: body.dueAt === undefined ? undefined : body.dueAt ? new Date(body.dueAt) : null, completedAt: body.status ? body.status === "DONE" ? new Date() : null : undefined } });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project_task", task.id, { operation: "UPDATE", ...body });
    return reply.send({ data: task });
  });
  app.delete("/admin/projects/:id/tasks/:taskId", { preHandler: [requireCapability("project.manage")] }, async (request, reply) => {
    const { id, taskId } = z.object({ id: z.string().min(1), taskId: z.string().min(1) }).parse(request.params);
    const project = await ownedProject(request.programId, currentAdmin(request), id);
    if (project.status !== "ACTIVE") throw new LoyaltyError("PROJECT_NOT_ACTIVE", 409);
    const deleted = await prisma.projectTask.deleteMany({ where: { id: taskId, projectId: id } });
    if (!deleted.count) throw new LoyaltyError("PROJECT_TASK_NOT_FOUND", 404);
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project_task", taskId, { operation: "DELETE", projectId: id });
    return reply.status(204).send();
  });
  app.post("/admin/projects/:id/complete", { preHandler: [requireCapability("project.manage")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const project = await ownedProject(request.programId, currentAdmin(request), id);
    if (project.status !== "ACTIVE") throw new LoyaltyError("PROJECT_NOT_ACTIVE", 409);
    const incomplete = await prisma.projectTask.count({ where: { projectId: id, status: { not: "DONE" } } });
    if (incomplete) throw new LoyaltyError("PROJECT_TASKS_INCOMPLETE", 409, { remaining: incomplete });
    const transition = await prisma.project.updateMany({
      where: { id, programId: request.programId, createdByAdminId: currentAdmin(request), status: "ACTIVE" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    if (transition.count !== 1) throw new LoyaltyError("PROJECT_NOT_ACTIVE", 409);
    const updated = await prisma.project.findFirstOrThrow({ where: { id, programId: request.programId } });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project", id, { operation: "CONFIRM_COMPLETION" });
    return reply.send({ data: updated });
  });
  app.post("/admin/projects/:id/submit-issuance", { preHandler: [requireCapability("project.manage")] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = z.object({ allocations: z.array(allocationSchema).min(1).max(10000) }).parse(request.body);
    const adminId = currentAdmin(request);
    const result = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({ where: { id, programId: request.programId, createdByAdminId: adminId }, include: { budgets: { include: { pointType: { select: { code: true, name: true } } } }, members: { where: { status: "ACCEPTED" }, include: { member: { select: { id: true, email: true, firstName: true, lastName: true } } } } } });
      if (!project) throw new LoyaltyError("PROJECT_NOT_FOUND", 404);
      if (!["COMPLETED", "ISSUE_REJECTED"].includes(project.status)) throw new LoyaltyError("PROJECT_NOT_COMPLETE", 409);
      const currentBatch = await tx.projectIssueBatch.findFirst({ where: { projectId: id, status: "PENDING" } });
      if (currentBatch) throw new LoyaltyError("PROJECT_ISSUANCE_PENDING", 409);
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
      const batch = await tx.projectIssueBatch.create({ data: { projectId: id, status: "DRAFT", submittedByAdminId: adminId } });
      await tx.projectGrantAllocation.createMany({ data: normalized.map((item) => ({ batchId: batch.id, projectId: id, budgetId: item.budgetId, memberId: item.memberId, pointTypeId: item.pointTypeId, amount: item.amount })) });
      const totalAmount = normalized.reduce((sum, item) => sum + item.amount, 0);
      const approval = await createApprovalRequestWithClient(tx, {
        programId: request.programId, actionKey: "PROJECT_POINT_ISSUANCE", requestedByType: "ADMIN_USER", requestedById: adminId, requesterAdminId: adminId,
        subjectType: "ProjectIssueBatch", subjectId: batch.id, idempotencyKey: `project-issue:${batch.id}`,
        payload: { projectId: id, projectName: project.name, totalAmount, allocations: normalized.map((item) => ({ member: [item.member.firstName, item.member.lastName].filter(Boolean).join(" ") || item.member.email, email: item.member.email, pointType: item.name, pointTypeCode: item.code, amount: item.amount })) } as Prisma.InputJsonValue,
        scopeContext: { amount: totalAmount },
      });
      if (!approval) throw new LoyaltyError("PROJECT_ISSUANCE_WORKFLOW_NOT_CONFIGURED", 409);
      await tx.projectIssueBatch.update({ where: { id: batch.id }, data: { approvalRequestId: approval.id, status: "PENDING" } });
      await tx.project.update({ where: { id }, data: { status: "ISSUE_PENDING" } });
      return { approval, batchId: batch.id, totalAmount };
    });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "project", id, { operation: "SUBMIT_ISSUANCE", issueBatchId: result.batchId, totalAmount: result.totalAmount, approvalRequestId: result.approval.id });
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
      include: { project: { include: { tasks: { where: { assigneeId: request.memberId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } } } },
      orderBy: { invitedAt: "desc" },
    });
    return reply.send({ data: memberships.map(({ project, ...membership }) => ({ ...membership, project: { id: project.id, name: project.name, description: project.description, status: project.status, fieldValues: project.fieldValues, tasks: project.tasks } })) });
  });
  app.post("/members/me/projects/:id/respond", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { response } = z.object({ response: z.enum(["ACCEPTED", "DECLINED"]) }).parse(request.body);
    const membership = await prisma.projectMember.findFirst({ where: { projectId: id, memberId: request.memberId, project: { programId: request.programId, status: "ACTIVE" } } });
    if (!membership) throw new LoyaltyError("PROJECT_INVITATION_NOT_FOUND", 404);
    if (membership.status !== "INVITED") throw new LoyaltyError("PROJECT_INVITATION_ALREADY_ANSWERED", 409);
    const updated = await prisma.projectMember.update({ where: { id: membership.id }, data: { status: response, respondedAt: new Date() } });
    return reply.send({ data: updated });
  });
  app.patch("/members/me/projects/:projectId/tasks/:taskId", async (request, reply) => {
    if (!request.memberId) throw new LoyaltyError("UNAUTHORIZED", 401);
    const { projectId, taskId } = z.object({ projectId: z.string().min(1), taskId: z.string().min(1) }).parse(request.params);
    const { status } = z.object({ status: z.enum(["IN_PROGRESS", "DONE"]) }).parse(request.body);
    const membership = await prisma.projectMember.findFirst({ where: { projectId, memberId: request.memberId, status: "ACCEPTED", project: { programId: request.programId, status: "ACTIVE" } }, select: { id: true } });
    if (!membership) throw new LoyaltyError("PROJECT_MEMBERSHIP_REQUIRED", 403);
    const task = await prisma.projectTask.findFirst({ where: { id: taskId, projectId, assigneeId: request.memberId } });
    if (!task) throw new LoyaltyError("PROJECT_TASK_NOT_FOUND", 404);
    const updated = await prisma.projectTask.update({ where: { id: taskId }, data: { status, completedAt: status === "DONE" ? new Date() : null } });
    return reply.send({ data: updated });
  });

  done();
}
