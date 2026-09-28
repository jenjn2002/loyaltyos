import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import {
  deleteWorkflow,
  getWorkflow,
  listWorkflows,
  saveWorkflow,
  setWorkflowActive,
  type WorkflowDefinitionInput,
} from "../../lib/approval-workflows.js";
import { LoyaltyError } from "../../lib/errors.js";
import { ADMIN_ROLE_LABELS, requireCapability } from "../../lib/permissions.js";

const assignmentSchema = z
  .object({
    adminUserId: z.string().min(1).optional(),
    role: z.string().trim().min(2).max(80).regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  })
  .refine((value) => Boolean(value.adminUserId) !== Boolean(value.role), {
    message: "Exactly one adminUserId or role is required",
  });

const stepSchema = z.object({
  name: z.string().trim().min(1).max(160),
  approvalMode: z.enum(["ANY", "ALL", "COUNT"]).default("ANY"),
  requiredApprovalCount: z.coerce.number().int().min(1).default(1),
  assignees: z.array(assignmentSchema).min(1).max(100),
});

const workflowSchema = z.object({
  actionKey: z.string().trim().toUpperCase().min(2).max(80),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  priority: z.coerce.number().int().default(0),
  scope: z.record(z.unknown()).default({}),
  selfApprovalPolicy: z.enum(["DENY", "ALLOW"]).default("DENY"),
  isActive: z.boolean().default(false),
  steps: z.array(stepSchema).min(1).max(20),
});

function actorId(request: { adminId: string | null }): string {
  if (!request.adminId) throw new LoyaltyError("ADMIN_SESSION_REQUIRED", 403);
  return request.adminId;
}

export function adminWorkflowsRoutes(
  app: FastifyInstance,
  _opts: unknown,
  done: () => void,
): void {
  app.get(
    "/admin/workflows",
    { preHandler: [requireCapability("workflow.view")] },
    async (request, reply) => reply.send({ data: await listWorkflows(request.programId) }),
  );

  app.get(
    "/admin/workflows/:id",
    { preHandler: [requireCapability("workflow.view")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      return reply.send({ data: await getWorkflow(request.programId, id) });
    },
  );

  app.get(
    "/admin/workflow-approvers",
    { preHandler: [requireCapability("workflow.view")] },
    async (request, reply) => {
      const users = await prisma.adminUser.findMany({
        where: { programId: request.programId, isActive: true },
        select: { id: true, email: true, name: true, role: true },
        orderBy: { name: "asc" },
      });
      const customRoles = await prisma.adminRoleDefinition.findMany({
        where: { programId: request.programId },
        select: { role: true, label: true },
        orderBy: [{ label: "asc" }, { role: "asc" }],
      });
      return reply.send({
        data: {
          users,
          roles: [
            ...Object.entries(ADMIN_ROLE_LABELS).map(([value, label]) => ({ value, label })),
            ...customRoles.map(({ role: value, label }) => ({ value, label })),
          ],
        },
      });
    },
  );

  app.get(
    "/admin/workflow-scope-options",
    { preHandler: [requireCapability("workflow.view")] },
    async (request, reply) => {
      const [pointTypes, rewards] = await Promise.all([
        prisma.pointTypeDefinition.findMany({
          where: { programId: request.programId, isActive: true, archivedAt: null },
          select: { id: true, code: true, name: true, isActive: true, archivedAt: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        }),
        prisma.reward.findMany({
          where: { programId: request.programId, isActive: true, deletedAt: null },
          select: { id: true, name: true, category: true },
          orderBy: { name: "asc" },
        }),
      ]);
      return reply.send({ data: { pointTypes, rewards } });
    },
  );

  app.post(
    "/admin/workflows",
    { preHandler: [requireCapability("workflow.manage")] },
    async (request, reply) => {
      const input = workflowSchema.parse(request.body) as WorkflowDefinitionInput;
      const workflow = await saveWorkflow(request.programId, input, actorId(request));
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "approval_workflow", workflow.id, {
        operation: "CREATE",
        actionKey: input.actionKey,
        name: input.name,
        priority: input.priority,
        scope: input.scope,
        selfApprovalPolicy: input.selfApprovalPolicy,
        isActive: input.isActive,
        steps: input.steps,
      });
      return reply.status(201).send({ data: workflow });
    },
  );

  app.patch(
    "/admin/workflows/:id",
    { preHandler: [requireCapability("workflow.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const input = workflowSchema.parse(request.body) as WorkflowDefinitionInput;
      const workflow = await saveWorkflow(request.programId, input, actorId(request), id);
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "approval_workflow", id, {
        operation: "UPDATE",
        actionKey: input.actionKey,
        name: input.name,
        priority: input.priority,
        scope: input.scope,
        selfApprovalPolicy: input.selfApprovalPolicy,
        isActive: input.isActive,
        steps: input.steps,
      });
      return reply.send({
        data: workflow,
      });
    },
  );

  app.post(
    "/admin/workflows/:id/activate",
    { preHandler: [requireCapability("workflow.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = z.object({ isActive: z.boolean().default(true) }).default({}).parse(request.body);
      const workflow = await setWorkflowActive(request.programId, id, body.isActive, actorId(request));
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "approval_workflow", id, {
        operation: body.isActive ? "ACTIVATE" : "DEACTIVATE",
        actionKey: workflow.actionKey,
        name: workflow.name,
        isActive: workflow.isActive,
      });
      return reply.send({
        data: workflow,
      });
    },
  );

  app.delete(
    "/admin/workflows/:id",
    { preHandler: [requireCapability("workflow.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const workflow = await getWorkflow(request.programId, id);
      await deleteWorkflow(request.programId, id);
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "approval_workflow", id, {
        operation: "DELETE",
        actionKey: workflow.actionKey,
        name: workflow.name,
      });
      return reply.status(204).send();
    },
  );

  done();
}
