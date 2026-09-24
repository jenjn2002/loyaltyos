import { type AdminRole, Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "../db.js";
import { LoyaltyError } from "./errors.js";

export const BUILTIN_WORKFLOW_ACTIONS = [
  "POINT_EXCHANGE",
  "POINT_ISSUANCE_PROPOSAL",
  "CAMPAIGN_ISSUANCE_PROPOSAL",
  "LEAVE_REQUEST",
  "REWARD_REDEMPTION",
  "CUSTOM",
] as const;

export interface WorkflowAssignmentInput { adminUserId?: string; role?: AdminRole }
export interface WorkflowStepInput {
  name: string;
  approvalMode: "ANY" | "ALL" | "COUNT";
  requiredApprovalCount: number;
  assignees: WorkflowAssignmentInput[];
}
export interface WorkflowDefinitionInput {
  actionKey: string;
  name: string;
  description?: string;
  priority?: number;
  scope?: WorkflowScope;
  selfApprovalPolicy: "DENY" | "ALLOW";
  isActive?: boolean;
  steps: WorkflowStepInput[];
}

/** Known built-in filters plus room for module-specific JSON fields. */
export interface WorkflowScope {
  pointTypeIds?: string[];
  minAmount?: number;
  maxAmount?: number;
  minValueMinor?: number;
  maxValueMinor?: number;
  rewardIds?: string[];
  rewardCategories?: string[];
  [key: string]: unknown;
}

export interface WorkflowMatchContext {
  pointTypeId?: string;
  amount?: number;
  valueMinor?: number;
  rewardId?: string;
  rewardCategory?: string | null;
  attributes?: Record<string, unknown>;
}

export interface ApprovalRequestInput {
  programId: string;
  actionKey: string;
  requestedByType: string;
  requestedById: string;
  requesterAdminId?: string;
  subjectType: string;
  subjectId: string;
  payload?: Prisma.InputJsonValue;
  idempotencyKey?: string;
  scopeContext?: WorkflowMatchContext;
}

export interface ApprovalRequestDecisionContext {
  id: string;
  programId: string;
  actionKey: string;
  subjectType: string;
  subjectId: string;
}

export type ApprovalDecisionHook = (
  tx: Prisma.TransactionClient,
  request: ApprovalRequestDecisionContext,
  decision: "APPROVE" | "REJECT",
  actorId: string,
  comment?: string,
) => Promise<void>;

type WorkflowDb = PrismaClient | Prisma.TransactionClient;
interface AssigneeSnapshot {
  adminId: string;
  email: string;
  name: string;
  role: AdminRole;
  assignedVia: "USER" | "ROLE";
  assignedRole?: AdminRole;
}

const ADMIN_ROLES = new Set<AdminRole>(["SUPER_ADMIN", "OPERATOR", "ANALYST"]);

function isPrismaClient(db: WorkflowDb): db is PrismaClient {
  return "$transaction" in db;
}

async function serializable<T>(
  db: WorkflowDb,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!isPrismaClient(db)) return operation(db);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034" ||
        attempt === 2
      )
        throw error;
    }
  }
  throw new Error("Serializable workflow transaction failed after retries");
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function snapshotItems(value: unknown): AssigneeSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is AssigneeSnapshot => {
    const candidate = jsonObject(item);
    return typeof candidate.adminId === "string";
  });
}

function scopeObject(value: unknown): WorkflowScope {
  return jsonObject(value) as WorkflowScope;
}

function stringList(scope: WorkflowScope, key: string): string[] | undefined {
  const value = scope[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function numberValue(scope: WorkflowScope, key: string): number | undefined {
  const value = scope[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function validateScope(actionKey: string, scope: WorkflowScope): void {
  const arrayKeys = ["pointTypeIds", "rewardIds", "rewardCategories"];
  for (const key of arrayKeys) {
    const value = scope[key];
    if (value !== undefined) {
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim()))
        throw new LoyaltyError("WORKFLOW_SCOPE_INVALID", 400);
      if (new Set(value).size !== value.length) throw new LoyaltyError("WORKFLOW_SCOPE_DUPLICATE_VALUE", 400);
    }
  }
  const numericKeys = ["minAmount", "maxAmount", "minValueMinor", "maxValueMinor"];
  for (const key of numericKeys) {
    const value = scope[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 0))
      throw new LoyaltyError("WORKFLOW_SCOPE_NUMBER_INVALID", 400);
  }
  const minAmount = numberValue(scope, "minAmount");
  const maxAmount = numberValue(scope, "maxAmount");
  const minValueMinor = numberValue(scope, "minValueMinor");
  const maxValueMinor = numberValue(scope, "maxValueMinor");
  if (minAmount != null && maxAmount != null && minAmount > maxAmount)
    throw new LoyaltyError("WORKFLOW_SCOPE_RANGE_INVALID", 400);
  if (minValueMinor != null && maxValueMinor != null && minValueMinor > maxValueMinor)
    throw new LoyaltyError("WORKFLOW_SCOPE_RANGE_INVALID", 400);
  if (actionKey === "POINT_EXCHANGE" && (scope.rewardIds !== undefined || scope.rewardCategories !== undefined))
    throw new LoyaltyError("WORKFLOW_SCOPE_INVALID", 400);
  if (actionKey === "REWARD_REDEMPTION" &&
      (scope.pointTypeIds !== undefined || minAmount != null || maxAmount != null || minValueMinor != null || maxValueMinor != null))
    throw new LoyaltyError("WORKFLOW_SCOPE_INVALID", 400);
}

function listMayOverlap(left: string[] | undefined, right: string[] | undefined): boolean {
  if (!left?.length || !right?.length) return true;
  return left.some((value) => right.includes(value));
}

function rangesMayOverlap(
  left: WorkflowScope,
  right: WorkflowScope,
  minKey: string,
  maxKey: string,
): boolean {
  const leftMin = numberValue(left, minKey) ?? Number.MIN_SAFE_INTEGER;
  const leftMax = numberValue(left, maxKey) ?? Number.MAX_SAFE_INTEGER;
  const rightMin = numberValue(right, minKey) ?? Number.MIN_SAFE_INTEGER;
  const rightMax = numberValue(right, maxKey) ?? Number.MAX_SAFE_INTEGER;
  return leftMin <= rightMax && rightMin <= leftMax;
}

export function workflowScopesMayOverlap(
  actionKey: string,
  leftInput: unknown,
  rightInput: unknown,
): boolean {
  const left = scopeObject(leftInput);
  const right = scopeObject(rightInput);
  if (["POINT_EXCHANGE", "POINT_ISSUANCE_PROPOSAL", "CAMPAIGN_ISSUANCE_PROPOSAL"].includes(actionKey)) {
    return (
      listMayOverlap(stringList(left, "pointTypeIds"), stringList(right, "pointTypeIds")) &&
      rangesMayOverlap(left, right, "minAmount", "maxAmount") &&
      rangesMayOverlap(left, right, "minValueMinor", "maxValueMinor")
    );
  }
  if (actionKey === "REWARD_REDEMPTION") {
    // ID/category intersections are checked independently. An ID-vs-category
    // relationship depends on current reward data, so fail closed if it might overlap.
    return (
      listMayOverlap(stringList(left, "rewardIds"), stringList(right, "rewardIds")) &&
      listMayOverlap(stringList(left, "rewardCategories"), stringList(right, "rewardCategories"))
    );
  }
  return true;
}

export function workflowMatchesScope(
  actionKey: string,
  scopeInput: unknown,
  context: WorkflowMatchContext = {},
): boolean {
  const scope = scopeObject(scopeInput);
  if (["POINT_EXCHANGE", "POINT_ISSUANCE_PROPOSAL", "CAMPAIGN_ISSUANCE_PROPOSAL"].includes(actionKey)) {
    const pointTypeIds = stringList(scope, "pointTypeIds");
    if (pointTypeIds?.length && (!context.pointTypeId || !pointTypeIds.includes(context.pointTypeId))) return false;
    for (const [minKey, maxKey, contextKey] of [
      ["minAmount", "maxAmount", "amount"],
      ["minValueMinor", "maxValueMinor", "valueMinor"],
    ] as const) {
      const min = numberValue(scope, minKey);
      const max = numberValue(scope, maxKey);
      const value = context[contextKey];
      if ((min != null || max != null) && (value == null || (min != null && value < min) || (max != null && value > max))) return false;
    }
    return true;
  }
  if (actionKey === "REWARD_REDEMPTION") {
    const rewardIds = stringList(scope, "rewardIds");
    const categories = stringList(scope, "rewardCategories");
    if (rewardIds?.length && (!context.rewardId || !rewardIds.includes(context.rewardId))) return false;
    if (categories?.length && (!context.rewardCategory || !categories.includes(context.rewardCategory))) return false;
    return true;
  }
  const attributes = context.attributes ?? {};
  return Object.entries(scope).every(([key, value]) => JSON.stringify(attributes[key]) === JSON.stringify(value));
}

export interface MatchableWorkflow {
  id: string;
  priority: number;
  scope: unknown;
}

export function selectMatchingWorkflow<T extends MatchableWorkflow>(
  workflows: T[],
  actionKey: string,
  context: WorkflowMatchContext = {},
): T | null {
  const matches = workflows
    .filter((workflow) => workflowMatchesScope(actionKey, workflow.scope, context))
    .sort((left, right) => right.priority - left.priority);
  const highestPriority = matches[0]?.priority;
  if (highestPriority == null) return null;
  const highest = matches.filter((workflow) => workflow.priority === highestPriority);
  if (highest.length > 1) {
    throw new LoyaltyError("WORKFLOW_SCOPE_CONFLICT", 409, {
      actionKey,
      priority: highestPriority,
      workflowIds: highest.map((workflow) => workflow.id),
    });
  }
  return highest[0] ?? null;
}

export function validateWorkflowDefinition(input: WorkflowDefinitionInput): void {
  if (!/^[A-Z][A-Z0-9_.:-]{1,79}$/.test(input.actionKey))
    throw new LoyaltyError("WORKFLOW_ACTION_KEY_INVALID", 400);
  if (!input.name.trim() || input.name.trim().length > 160)
    throw new LoyaltyError("WORKFLOW_NAME_INVALID", 400);
  if (input.description && input.description.length > 1000)
    throw new LoyaltyError("WORKFLOW_DESCRIPTION_INVALID", 400);
  if (!Number.isSafeInteger(input.priority ?? 0)) throw new LoyaltyError("WORKFLOW_PRIORITY_INVALID", 400);
  const scope = scopeObject(input.scope);
  validateScope(input.actionKey, scope);
  if (!input.steps.length || input.steps.length > 20)
    throw new LoyaltyError("WORKFLOW_STEPS_REQUIRED", 400);

  input.steps.forEach((step, index) => {
    if (!step.name.trim() || step.name.trim().length > 160)
      throw new LoyaltyError("WORKFLOW_STEP_NAME_INVALID", 400);
    if (!step.assignees.length) throw new LoyaltyError("WORKFLOW_ASSIGNEES_REQUIRED", 400);
    if (!Number.isInteger(step.requiredApprovalCount) || step.requiredApprovalCount < 1)
      throw new LoyaltyError("WORKFLOW_REQUIRED_COUNT_INVALID", 400);
    if (step.approvalMode === "ANY" && step.requiredApprovalCount !== 1)
      throw new LoyaltyError("WORKFLOW_ANY_COUNT_MUST_BE_ONE", 400);
    const seen = new Set<string>();
    for (const assignee of step.assignees) {
      const hasUser = Boolean(assignee.adminUserId);
      const hasRole = Boolean(assignee.role);
      if (hasUser === hasRole) throw new LoyaltyError("WORKFLOW_ASSIGNEE_INVALID", 400);
      if (assignee.role && !ADMIN_ROLES.has(assignee.role))
        throw new LoyaltyError("WORKFLOW_ROLE_INVALID", 400);
      const key = assignee.adminUserId
        ? `user:${assignee.adminUserId}`
        : `role:${assignee.role ?? ""}`;
      if (seen.has(key)) throw new LoyaltyError("WORKFLOW_DUPLICATE_ASSIGNEE", 400);
      seen.add(key);
    }
    // A role is one configuration row but can expand to many active users.
    // COUNT feasibility is checked against the expanded snapshot when a
    // request is created.
    if (index >= 20) throw new LoyaltyError("WORKFLOW_STEPS_TOO_MANY", 400);
  });
}

async function validateAssignedUsers(
  tx: Prisma.TransactionClient,
  programId: string,
  steps: WorkflowStepInput[],
): Promise<void> {
  const ids = [
    ...new Set(
      steps.flatMap((step) =>
        step.assignees.flatMap((assignee) => (assignee.adminUserId ? [assignee.adminUserId] : [])),
      ),
    ),
  ];
  if (ids.length) {
    const active = await tx.adminUser.findMany({
      where: { id: { in: ids }, programId, isActive: true },
      select: { id: true },
    });
    if (active.length !== ids.length) throw new LoyaltyError("WORKFLOW_ASSIGNEE_NOT_ACTIVE", 400);
  }
  const roles = [
    ...new Set(
      steps.flatMap((step) =>
        step.assignees.flatMap((assignee) => (assignee.role ? [assignee.role] : [])),
      ),
    ),
  ];
  if (roles.length) {
    const activeRoles = await tx.adminUser.groupBy({
      by: ["role"],
      where: { programId, isActive: true, role: { in: roles } },
      _count: { _all: true },
    });
    if (activeRoles.length !== roles.length)
      throw new LoyaltyError("WORKFLOW_ROLE_HAS_NO_ACTIVE_APPROVER", 400);
  }
}

async function workflowWithSteps(tx: Prisma.TransactionClient, programId: string, id: string) {
  const workflow = await tx.approvalWorkflow.findFirst({
    where: { id, programId },
    include: {
      steps: {
        orderBy: { stepOrder: "asc" },
        include: {
          assignees: {
            include: {
              adminUser: { select: { id: true, email: true, name: true, role: true, isActive: true } },
            },
          },
        },
      },
    },
  });
  if (!workflow) throw new LoyaltyError("WORKFLOW_NOT_FOUND", 404);
  return workflow;
}

async function validateActiveScopeConflicts(
  tx: Prisma.TransactionClient,
  programId: string,
  actionKey: string,
  priority: number,
  scope: unknown,
  excludeId?: string,
): Promise<void> {
  const peers = await tx.approvalWorkflow.findMany({
    where: {
      programId,
      actionKey,
      priority,
      isActive: true,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true, scope: true },
  });
  const conflict = peers.find((peer) => workflowScopesMayOverlap(actionKey, scope, peer.scope));
  if (conflict) {
    throw new LoyaltyError("WORKFLOW_SCOPE_PRIORITY_CONFLICT", 409, {
      conflictingWorkflowId: conflict.id,
      priority,
    });
  }
}

export async function listWorkflows(programId: string) {
  const workflows = await prisma.approvalWorkflow.findMany({
    where: { programId },
    include: { steps: { include: { assignees: true }, orderBy: { stepOrder: "asc" } } },
    orderBy: [{ actionKey: "asc" }, { priority: "desc" }, { isActive: "desc" }, { createdAt: "asc" }],
  });
  const creatorIds = [...new Set(workflows.map((workflow) => workflow.createdById).filter((id): id is string => Boolean(id)))];
  const creators = creatorIds.length
    ? await prisma.adminUser.findMany({ where: { id: { in: creatorIds }, programId: programId }, select: { id: true, name: true, email: true } })
    : [];
  const creatorMap = new Map(creators.map((creator) => [creator.id, creator]));
  return workflows.map((workflow) => ({
    ...workflow,
    createdBy: workflow.createdById ? creatorMap.get(workflow.createdById) ?? null : null,
  }));
}

export async function getWorkflow(programId: string, id: string) {
  return serializable(prisma, (tx) => workflowWithSteps(tx, programId, id));
}

export async function saveWorkflow(
  programId: string,
  input: WorkflowDefinitionInput,
  actorId: string,
  id?: string,
) {
  validateWorkflowDefinition(input);
  return serializable(prisma, async (tx) => {
    const priority = input.priority ?? 0;
    await validateAssignedUsers(tx, programId, input.steps);
    if (id) {
      const owned = await tx.approvalWorkflow.findFirst({ where: { id, programId }, select: { id: true } });
      if (!owned) throw new LoyaltyError("WORKFLOW_NOT_FOUND", 404);
    }
    const isActive = input.isActive ?? false;
    if (isActive)
      await validateActiveScopeConflicts(tx, programId, input.actionKey, priority, input.scope, id);

    const workflow = id
      ? await tx.approvalWorkflow.update({
          where: { id },
          data: {
            name: input.name.trim(),
            description: input.description?.trim() ?? null,
            priority,
            scope: (input.scope ?? {}) as unknown as Prisma.InputJsonValue,
            selfApprovalPolicy: input.selfApprovalPolicy,
            isActive,
            updatedById: actorId,
          },
        })
      : await tx.approvalWorkflow.create({
          data: {
            programId,
            actionKey: input.actionKey,
            name: input.name.trim(),
            description: input.description?.trim() ?? null,
            priority,
            scope: (input.scope ?? {}) as unknown as Prisma.InputJsonValue,
            selfApprovalPolicy: input.selfApprovalPolicy,
            isActive,
            createdById: actorId,
            updatedById: actorId,
          },
        });

    if (id) await tx.approvalWorkflowStep.deleteMany({ where: { workflowId: workflow.id } });
    for (const [index, step] of input.steps.entries()) {
      await tx.approvalWorkflowStep.create({
        data: {
          workflowId: workflow.id,
          stepOrder: index + 1,
          name: step.name.trim(),
          approvalMode: step.approvalMode,
          requiredApprovalCount: step.requiredApprovalCount,
          assignees: {
            create: step.assignees.map((assignee) => ({
              adminUserId: assignee.adminUserId,
              role: assignee.role,
            })),
          },
        },
      });
    }
    return workflowWithSteps(tx, programId, workflow.id);
  });
}

export async function setWorkflowActive(programId: string, id: string, isActive: boolean, actorId: string) {
  return serializable(prisma, async (tx) => {
    const workflow = await workflowWithSteps(tx, programId, id);
    if (isActive) {
      if (!workflow.steps.length) throw new LoyaltyError("WORKFLOW_STEPS_REQUIRED", 400);
      await validateActiveScopeConflicts(
        tx,
        programId,
        workflow.actionKey,
        workflow.priority,
        workflow.scope,
        workflow.id,
      );
      await validateAssignedUsers(
        tx,
        programId,
        workflow.steps.map((step) => ({
          name: step.name,
          approvalMode: step.approvalMode,
          requiredApprovalCount: step.requiredApprovalCount,
          assignees: step.assignees.map((assignee) => ({
            adminUserId: assignee.adminUserId ?? undefined,
            role: assignee.role ?? undefined,
          })),
        })),
      );
    }
    await tx.approvalWorkflow.update({ where: { id }, data: { isActive, updatedById: actorId } });
    return workflowWithSteps(tx, programId, id);
  });
}

export async function deleteWorkflow(programId: string, id: string): Promise<void> {
  await serializable(prisma, async (tx) => {
    const workflow = await tx.approvalWorkflow.findFirst({ where: { id, programId } });
    if (!workflow) throw new LoyaltyError("WORKFLOW_NOT_FOUND", 404);
    const requestCount = await tx.approvalRequest.count({ where: { workflowId: id } });
    if (requestCount > 0) throw new LoyaltyError("WORKFLOW_HAS_REQUEST_HISTORY", 409);
    await tx.approvalWorkflow.delete({ where: { id } });
  });
}

async function findMatchingWorkflow(
  tx: Prisma.TransactionClient,
  programId: string,
  actionKey: string,
  context: WorkflowMatchContext = {},
) {
  const workflows = await tx.approvalWorkflow.findMany({
    where: { programId, actionKey, isActive: true },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      steps: {
        orderBy: { stepOrder: "asc" },
        include: {
          assignees: { include: { adminUser: { select: { id: true, email: true, name: true, role: true, isActive: true } } } },
        },
      },
    },
  });
  return selectMatchingWorkflow(workflows, actionKey, context);
}

async function expandAssignees(
  tx: Prisma.TransactionClient,
  programId: string,
  step: Awaited<ReturnType<typeof findMatchingWorkflow>> extends infer Workflow
    ? Workflow extends { steps: (infer Step)[] }
      ? Step
      : never
    : never,
  requesterAdminId: string | undefined,
  selfApprovalPolicy: "DENY" | "ALLOW",
): Promise<AssigneeSnapshot[]> {
  const directIds = step.assignees.flatMap((assignee) =>
    assignee.adminUserId ? [assignee.adminUserId] : [],
  );
  const roles = step.assignees.flatMap((assignee) => (assignee.role ? [assignee.role] : []));
  const roleUsers = roles.length
    ? await tx.adminUser.findMany({
        where: { programId, isActive: true, role: { in: roles } },
        select: { id: true, email: true, name: true, role: true },
      })
    : [];
  const directUsers = directIds.length
    ? await tx.adminUser.findMany({
        where: { programId, id: { in: directIds }, isActive: true },
        select: { id: true, email: true, name: true, role: true },
      })
    : [];
  const byId = new Map<string, AssigneeSnapshot>();
  for (const user of directUsers) {
    byId.set(user.id, { ...user, adminId: user.id, assignedVia: "USER" });
  }
  for (const user of roleUsers) {
    if (!byId.has(user.id)) {
      const assignedRole = roles.find((role) => role === user.role);
      byId.set(user.id, { ...user, adminId: user.id, assignedVia: "ROLE", assignedRole });
    }
  }
  if (selfApprovalPolicy === "DENY" && requesterAdminId) byId.delete(requesterAdminId);
  return [...byId.values()];
}

export async function createApprovalRequestWithClient(
  tx: Prisma.TransactionClient,
  input: ApprovalRequestInput,
): Promise<Awaited<ReturnType<typeof getApprovalRequest>> | null> {
  const workflow = await findMatchingWorkflow(
    tx,
    input.programId,
    input.actionKey,
    input.scopeContext,
  );
  if (!workflow) return null;
  if (!workflow.steps.length) throw new LoyaltyError("WORKFLOW_STEPS_REQUIRED", 409);

  if (input.idempotencyKey) {
    const existing = await tx.approvalRequest.findFirst({
      where: {
        programId: input.programId,
        actionKey: input.actionKey,
        idempotencyKey: input.idempotencyKey,
      },
    });
    if (existing) return getApprovalRequestWithClient(tx, input.programId, existing.id);
  }

  const snapshots: { step: (typeof workflow.steps)[number]; assignees: AssigneeSnapshot[]; required: number }[] = [];
  for (const step of workflow.steps) {
    const assignees = await expandAssignees(
      tx,
      input.programId,
      step,
      input.requesterAdminId,
      workflow.selfApprovalPolicy,
    );
    if (!assignees.length) throw new LoyaltyError("WORKFLOW_NO_ELIGIBLE_APPROVERS", 409);
    const required =
      step.approvalMode === "ANY"
        ? 1
        : step.approvalMode === "ALL"
          ? assignees.length
          : step.requiredApprovalCount;
    if (required > assignees.length) throw new LoyaltyError("WORKFLOW_REQUIRED_COUNT_IMPOSSIBLE", 409);
    snapshots.push({ step, assignees, required });
  }

  const request = await tx.approvalRequest.create({
    data: {
      programId: input.programId,
      workflowId: workflow.id,
      actionKey: input.actionKey,
      requestedByType: input.requestedByType,
      requestedById: input.requestedById,
      requesterAdminId: input.requesterAdminId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      payload: input.payload ?? {},
      scopeSnapshot: {
        configured: workflow.scope,
        context: input.scopeContext ?? {},
      } as unknown as Prisma.InputJsonValue,
      workflowSnapshot: {
        actionKey: workflow.actionKey,
        name: workflow.name,
        description: workflow.description,
        priority: workflow.priority,
        scope: workflow.scope,
        selfApprovalPolicy: workflow.selfApprovalPolicy,
        steps: snapshots.map(({ step, assignees, required }) => ({
          stepOrder: step.stepOrder,
          name: step.name,
          approvalMode: step.approvalMode,
          requiredApprovalCount: required,
          assignees,
        })),
      } as unknown as Prisma.InputJsonValue,
      currentStepOrder: snapshots[0]?.step.stepOrder,
      idempotencyKey: input.idempotencyKey,
    },
  });
  for (const [index, { step, assignees, required }] of snapshots.entries()) {
    await tx.approvalRequestStep.create({
      data: {
        approvalRequestId: request.id,
        stepOrder: step.stepOrder,
        name: step.name,
        approvalMode: step.approvalMode,
        requiredApprovalCount: required,
        assigneesSnapshot: assignees as unknown as Prisma.InputJsonValue,
        status: index === 0 ? "PENDING" : "WAITING",
        openedAt: index === 0 ? new Date() : null,
      },
    });
  }
  return getApprovalRequestWithClient(tx, input.programId, request.id);
}

export async function createApprovalRequest(input: ApprovalRequestInput) {
  return serializable(prisma, (tx) => createApprovalRequestWithClient(tx, input));
}

export async function getApprovalRequestWithClient(tx: Prisma.TransactionClient, programId: string, id: string) {
  const request = await tx.approvalRequest.findFirst({
    where: { id, programId },
    include: {
      workflow: { select: { id: true, actionKey: true, name: true, isActive: true } },
      steps: {
        orderBy: { stepOrder: "asc" },
        include: {
          decisions: {
            orderBy: { createdAt: "asc" },
            include: { approver: { select: { id: true, name: true, email: true, role: true } } },
          },
        },
      },
    },
  });
  if (!request) throw new LoyaltyError("APPROVAL_REQUEST_NOT_FOUND", 404);
  return request;
}

export async function getApprovalRequest(programId: string, id: string) {
  return serializable(prisma, (tx) => getApprovalRequestWithClient(tx, programId, id));
}

function includesApprover(step: { assigneesSnapshot: unknown }, adminId: string): boolean {
  return snapshotItems(step.assigneesSnapshot).some((assignee) => assignee.adminId === adminId);
}

export async function listApprovalRequests(
  programId: string,
  input: { inboxForAdminId?: string; status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" },
) {
  const requests = await prisma.approvalRequest.findMany({
    where: { programId, ...(input.status ? { status: input.status } : {}) },
    include: {
      workflow: { select: { actionKey: true, name: true } },
      steps: {
        orderBy: { stepOrder: "asc" },
        include: { decisions: { select: { decision: true, approverAdminId: true } } },
      },
    },
    orderBy: { requestedAt: "desc" },
    take: 200,
  });
  if (!input.inboxForAdminId) return requests;
  const inboxAdminId = input.inboxForAdminId;
  return requests.filter((request) => {
    if (request.status !== "PENDING" || request.currentStepOrder == null) return false;
    const step = request.steps.find((candidate) => candidate.stepOrder === request.currentStepOrder);
    return Boolean(step && step.status === "PENDING" && includesApprover(step, inboxAdminId));
  });
}

export async function decideApprovalRequest(
  programId: string,
  requestId: string,
  approverAdminId: string,
  decision: "APPROVE" | "REJECT",
  comment: string | undefined,
  hook?: ApprovalDecisionHook,
) {
  if (decision === "REJECT" && !comment?.trim())
    throw new LoyaltyError("APPROVAL_REJECTION_COMMENT_REQUIRED", 400);
  return serializable(prisma, (tx) =>
    decideApprovalRequestWithClient(
      tx,
      programId,
      requestId,
      approverAdminId,
      decision,
      comment,
      hook,
    ),
  );
}

export async function decideApprovalRequestWithClient(
  tx: Prisma.TransactionClient,
  programId: string,
  requestId: string,
  approverAdminId: string,
  decision: "APPROVE" | "REJECT",
  comment: string | undefined,
  hook?: ApprovalDecisionHook,
) {
  if (decision === "REJECT" && !comment?.trim())
    throw new LoyaltyError("APPROVAL_REJECTION_COMMENT_REQUIRED", 400);
    const request = await tx.approvalRequest.findFirst({
      where: { id: requestId, programId },
      include: {
        steps: {
          orderBy: { stepOrder: "asc" },
          include: {
            decisions: { orderBy: { createdAt: "asc" } },
          },
        },
      },
    });
    if (!request) throw new LoyaltyError("APPROVAL_REQUEST_NOT_FOUND", 404);
    if (request.status !== "PENDING") throw new LoyaltyError("APPROVAL_REQUEST_NOT_PENDING", 409);
    const current = request.steps.find(
      (step) => step.stepOrder === request.currentStepOrder && step.status === "PENDING",
    );
    if (!current) throw new LoyaltyError("APPROVAL_STEP_OUT_OF_ORDER", 409);
    const approver = await tx.adminUser.findFirst({
      where: { id: approverAdminId, programId, isActive: true },
      select: { id: true },
    });
    if (!approver) throw new LoyaltyError("APPROVER_NOT_ACTIVE", 403);
    if (!includesApprover(current, approverAdminId))
      throw new LoyaltyError("APPROVER_NOT_ELIGIBLE", 403);
    if (current.decisions.some((existing) => existing.approverAdminId === approverAdminId))
      throw new LoyaltyError("APPROVAL_DUPLICATE_DECISION", 409);

    try {
      await tx.approvalDecision.create({
        data: {
          programId,
          approvalRequestId: request.id,
          stepId: current.id,
          approverAdminId,
          decision,
          comment: comment?.trim() ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new LoyaltyError("APPROVAL_DUPLICATE_DECISION", 409);
      throw error;
    }

    const context: ApprovalRequestDecisionContext = {
      id: request.id,
      programId,
      actionKey: request.actionKey,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
    };
    const now = new Date();
    if (decision === "REJECT") {
      if (hook) await hook(tx, context, decision, approverAdminId, comment?.trim());
      await tx.approvalRequestStep.update({
        where: { id: current.id },
        data: { status: "REJECTED", completedAt: now },
      });
      await tx.approvalRequestStep.updateMany({
        where: { approvalRequestId: request.id, status: "WAITING" },
        data: { status: "SKIPPED" },
      });
      await tx.approvalRequest.update({
        where: { id: request.id },
        data: {
          status: "REJECTED",
          currentStepOrder: null,
          resolvedAt: now,
          resolvedBy: approverAdminId,
          resolutionComment: comment?.trim(),
        },
      });
    } else {
      const approvals = current.decisions.filter((item) => item.decision === "APPROVE").length + 1;
      if (approvals >= current.requiredApprovalCount) {
        await tx.approvalRequestStep.update({
          where: { id: current.id },
          data: { status: "APPROVED", completedAt: now },
        });
        const next = request.steps.find((step) => step.stepOrder > current.stepOrder);
        if (next) {
          await tx.approvalRequestStep.update({
            where: { id: next.id },
            data: { status: "PENDING", openedAt: now },
          });
          await tx.approvalRequest.update({
            where: { id: request.id },
            data: { currentStepOrder: next.stepOrder },
          });
        } else {
          if (hook) {
            // The hook runs once per decision. Re-invoke it only for the
            // final transition so integrations can settle their subject.
            await hook(tx, context, "APPROVE", approverAdminId, comment?.trim());
          }
          await tx.approvalRequest.update({
            where: { id: request.id },
            data: {
              status: "APPROVED",
              currentStepOrder: null,
              resolvedAt: now,
              resolvedBy: approverAdminId,
              resolutionComment: comment?.trim(),
            },
          });
        }
      }
    }
  return getApprovalRequestWithClient(tx, programId, request.id);
}

export async function ensurePointExchangeApprovalRequest(
  programId: string,
  pointExchangeRequestId: string,
  memberId: string,
) {
  return serializable(prisma, async (tx) => {
    const voucher = await tx.pointExchangeRequest.findFirst({
      where: { id: pointExchangeRequestId, programId, memberId },
    });
    if (!voucher) throw new LoyaltyError("POINT_EXCHANGE_REQUEST_NOT_FOUND", 404);
    if (voucher.approvalRequestId)
      return getApprovalRequestWithClient(tx, programId, voucher.approvalRequestId);
    const approval = await createApprovalRequestWithClient(tx, {
      programId,
      actionKey: "POINT_EXCHANGE",
      requestedByType: "MEMBER",
      requestedById: memberId,
      subjectType: "PointExchangeRequest",
      subjectId: voucher.id,
      payload: {
        documentNumber: voucher.documentNumber,
        memberId: voucher.memberId,
        pointTypeId: voucher.pointTypeId,
        amount: voucher.amount,
        valueMinor: voucher.valueMinor,
        currency: voucher.currency,
        payoutType: voucher.payoutType,
      },
      idempotencyKey: `point-exchange:${voucher.id}`,
      scopeContext: {
        pointTypeId: voucher.pointTypeId,
        amount: voucher.amount,
        valueMinor: voucher.valueMinor,
      },
    });
    if (!approval) return null;
    await tx.pointExchangeRequest.update({
      where: { id: voucher.id },
      data: { approvalRequestId: approval.id },
    });
    return getApprovalRequestWithClient(tx, programId, approval.id);
  });
}
