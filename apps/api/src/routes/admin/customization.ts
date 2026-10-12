import { Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { notifyApprovalAssignees } from "../../lib/admin-notifications.js";
import { createApprovalRequestWithClient } from "../../lib/approval-workflows.js";
import {
  CUSTOM_CONTEXTS, adminRole, assertCustomDocumentAccess, assertDefinitionAccess, builtinTargets, definitionSchema,
  fieldsFromJson, fieldVisible, inputJson, jsonRecord, roleAllowed, validateCustomValues, validateDefinition,
  visibleValues, type CustomField, type CustomDefinitionInput,
} from "../../lib/customization.js";
import { LoyaltyError } from "../../lib/errors.js";
import { ADMIN_ROLE_LABELS, assertCapability, requireCapability, type AdminCapability } from "../../lib/permissions.js";

const idSchema = z.object({ id: z.string().min(1) });
const recordBody = z.object({ title: z.string().trim().min(1).max(200), values: z.record(z.unknown()).default({}), recordId: z.string().min(1).nullable().optional(), version: z.number().int().positive().optional() });
const statesFrom = (value: unknown): { key: string; label: string; initial: boolean; terminal: boolean }[] => definitionSchema.shape.states.parse(value);
async function pinDefinition(tx: Prisma.TransactionClient, definition: { id: string; programId: string; version: number; updatedAt: Date }) {
  // The no-op update acquires the same row lock as definition edits, without
  // incrementing the configuration revision for ordinary document actions.
  const pinned = await tx.customFunctionDefinition.updateMany({ where: { id: definition.id, programId: definition.programId, version: definition.version, isActive: true }, data: { updatedAt: definition.updatedAt } });
  if (!pinned.count) throw new LoyaltyError("CUSTOMIZATION_VERSION_CONFLICT", 409);
}
const allowedTransitions = (definition: { transitions: unknown }, record: { status: string; pendingTransition: unknown }, role: string) => record.pendingTransition ? [] : definitionSchema.shape.transitions.parse(definition.transitions).filter(item => item.from === record.status && roleAllowed(item.roles, role));
async function can(request: FastifyRequest, capability: AdminCapability): Promise<boolean> {
  try { await assertCapability(request, capability); return true; } catch (error) { if (error instanceof LoyaltyError && error.httpStatus === 403) return false; throw error; }
}
async function configurationRoles(programId: string) {
  return [...Object.entries(ADMIN_ROLE_LABELS).map(([value, label]) => ({ value, label })), ...(await prisma.adminRoleDefinition.findMany({ where: { programId }, select: { role: true, label: true } })).map(role => ({ value: role.role, label: role.label }))];
}
async function validateConfiguration(programId: string, body: CustomDefinitionInput) {
  validateDefinition(body);
  const knownRoles = new Set((await configurationRoles(programId)).map(role => role.value));
  const roleReferences = [...body.readRoles, ...body.writeRoles, ...body.fields.flatMap(field => field.readRoles), ...body.transitions.flatMap(transition => transition.roles)];
  if (roleReferences.some(role => !knownRoles.has(role))) throw new LoyaltyError("CUSTOMIZATION_ROLE_UNKNOWN", 400);
  if (body.writeRoles.some(role => role !== "SUPER_ADMIN" && !body.readRoles.includes(role))) throw new LoyaltyError("CUSTOMIZATION_WRITER_MUST_READ", 400);
  const workflowIds = [...new Set(body.transitions.flatMap(transition => transition.workflowId ? [transition.workflowId] : []))];
  if (workflowIds.length && await prisma.approvalWorkflow.count({ where: { id: { in: workflowIds }, programId, actionKey: "CUSTOM_DOCUMENT_APPROVAL", isActive: true } }) !== workflowIds.length)
    throw new LoyaltyError("CUSTOMIZATION_WORKFLOW_INVALID", 400);
}
async function validateFileReferences(programId: string, contextId: string, values: Record<string, unknown>, fields: CustomField[]) {
  const ids = fields.filter(field => field.type === "FILE").flatMap(field => { const file = jsonRecord(values[field.key]); return typeof file.attachmentId === "string" ? [file.attachmentId] : []; });
  if (!ids.length) return;
  if (await prisma.customAttachment.count({ where: { id: { in: [...new Set(ids)] }, programId, contextType: "CUSTOM_DOCUMENT", contextId } }) !== new Set(ids).size)
    throw new LoyaltyError("CUSTOMIZATION_FILE_INVALID", 400);
}
function rejectHiddenWrites(fields: CustomField[], values: Record<string, unknown>, role: string) {
  if (fields.some(field => !fieldVisible(field, role) && Object.prototype.hasOwnProperty.call(values, field.key))) throw new LoyaltyError("CUSTOMIZATION_FIELD_ACCESS_DENIED", 403);
}

export function adminCustomizationRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get("/admin/customization/catalog", async (request, reply) => {
    await adminRole(request);
    const canConfigure = await can(request, "customization.manage");
    if (!canConfigure) await assertCapability(request, "custom_document.view");
    return reply.send({ data: {
      contexts: CUSTOM_CONTEXTS,
      roles: canConfigure ? await configurationRoles(request.programId) : [],
      workflows: canConfigure ? await prisma.approvalWorkflow.findMany({ where: { programId: request.programId, actionKey: "CUSTOM_DOCUMENT_APPROVAL", isActive: true }, select: { id: true, name: true, actionKey: true, isActive: true } }) : [],
      canConfigure, canManageDocuments: await can(request, "custom_document.manage"),
      canViewDocuments: await can(request, "custom_document.view"),
    } });
  });
  app.get("/admin/customization/definitions", async (request, reply) => {
    const role = await adminRole(request);
    const query = z.object({ context: z.string().optional() }).parse(request.query);
    const canConfigure = await can(request, "customization.manage");
    const definitions = await prisma.customFunctionDefinition.findMany({ where: { programId: request.programId, ...(query.context ? { context: query.context } : {}), ...(!canConfigure ? { isActive: true } : {}) }, orderBy: { name: "asc" } });
    const result = [];
    for (const definition of definitions) {
      // The distribution editor consumes field descriptions under project.view;
      // configuring them is still owner/delegated customization.manage only.
      if (!canConfigure) {
        try {
          if (query.context === "PROJECT_DISTRIBUTION" && definition.context === "PROJECT_DISTRIBUTION") {
            // Only the role-filtered field configuration is exposed here. The
            // project editor is not a custom-document editor, and target/batch
            // values remain separately protected by project ownership/finance.
            await assertCapability(request, "project.view");
            if (!roleAllowed(definition.readRoles, role)) throw new LoyaltyError("CUSTOMIZATION_ACCESS_DENIED", 403);
          } else await assertDefinitionAccess(request, definition, role, false);
        } catch (error) { if (error instanceof LoyaltyError && error.httpStatus === 403) continue; throw error; }
      }
      let canManage = false;
      try { await assertDefinitionAccess(request, definition, role, true); canManage = definition.isActive; } catch (error) { if (!(error instanceof LoyaltyError && error.httpStatus === 403)) throw error; }
      result.push({ ...definition, canManage, fields: fieldsFromJson(definition.fields).filter(field => canConfigure || fieldVisible(field, role)) });
    }
    return reply.send({ data: result });
  });
  app.post("/admin/customization/definitions", { preHandler: [requireCapability("customization.manage")] }, async (request, reply) => {
    await adminRole(request);
    const body = definitionSchema.parse(request.body);
    await validateConfiguration(request.programId, body);
    if (body.context !== "CUSTOM" && await prisma.customFunctionDefinition.findFirst({ where: { programId: request.programId, context: body.context } })) throw new LoyaltyError("CUSTOMIZATION_CONTEXT_EXISTS", 409);
    const created = await prisma.customFunctionDefinition.create({ data: { ...body, fields: inputJson(body.fields), states: inputJson(body.states), transitions: inputJson(body.transitions), programId: request.programId, createdByAdminId: request.adminId! } });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "custom_function", created.id, { operation: "CREATE", key: body.key, context: body.context, fields: body.fields.map(field => field.key) });
    return reply.status(201).send({ data: created });
  });
  app.patch("/admin/customization/definitions/:id", { preHandler: [requireCapability("customization.manage")] }, async (request, reply) => {
    await adminRole(request);
    const { id } = idSchema.parse(request.params);
    const body = definitionSchema.extend({ version: z.number().int().positive() }).parse(request.body);
    const existing = await prisma.customFunctionDefinition.findFirst({ where: { id, programId: request.programId } });
    if (!existing) throw new LoyaltyError("CUSTOMIZATION_NOT_FOUND", 404);
    if (existing.key !== body.key || existing.context !== body.context) throw new LoyaltyError("CUSTOMIZATION_KEY_IMMUTABLE", 400);
    await validateConfiguration(request.programId, body);
    const updated = await prisma.$transaction(async tx => {
      const pinned = await tx.customFunctionDefinition.updateMany({ where: { id, programId: request.programId, version: body.version }, data: { version: { increment: 1 } } });
      if (!pinned.count) throw new LoyaltyError("CUSTOMIZATION_VERSION_CONFLICT", 409);
      if (await tx.customDocument.count({ where: { definitionId: id, pendingTransition: { not: Prisma.DbNull }, archivedAt: null } })) throw new LoyaltyError("CUSTOMIZATION_HAS_PENDING_DOCUMENTS", 409);
      const usedStates = await tx.customDocument.findMany({ where: { definitionId: id, archivedAt: null }, select: { status: true }, distinct: ["status"] });
      if (usedStates.some(item => !body.states.some(state => state.key === item.status))) throw new LoyaltyError("CUSTOMIZATION_STATE_IN_USE", 409);
      const originalFields = fieldsFromJson(existing.fields);
      const changedTypes = originalFields.filter(field => body.fields.some(next => next.key === field.key && next.type !== field.type));
      if (changedTypes.length && await tx.customDocument.count({ where: { definitionId: id } })) throw new LoyaltyError("CUSTOMIZATION_FIELD_TYPE_IN_USE", 409);
      const { version: _version, ...configuration } = body;
      return tx.customFunctionDefinition.update({ where: { id }, data: { ...configuration, fields: inputJson(body.fields), states: inputJson(body.states), transitions: inputJson(body.transitions) } });
    });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "custom_function", id, { operation: "UPDATE", key: body.key, fields: body.fields.map(field => field.key) });
    return reply.send({ data: updated });
  });
  app.delete("/admin/customization/definitions/:id", { preHandler: [requireCapability("customization.manage")] }, async (request, reply) => {
    await adminRole(request);
    const { id } = idSchema.parse(request.params);
    const definition = await prisma.customFunctionDefinition.findFirst({ where: { id, programId: request.programId } });
    if (!definition) throw new LoyaltyError("CUSTOMIZATION_NOT_FOUND", 404);
    await prisma.$transaction(async tx => {
      await tx.customFunctionDefinition.update({ where: { id }, data: { version: { increment: 1 } } });
      if (await tx.customDocument.count({ where: { definitionId: id, pendingTransition: { not: Prisma.DbNull } } })) throw new LoyaltyError("CUSTOMIZATION_HAS_PENDING_DOCUMENTS", 409);
      await tx.customFunctionDefinition.update({ where: { id }, data: { isActive: false } });
    });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "custom_function", id, { operation: "ARCHIVE", key: definition.key });
    return reply.status(204).send();
  });
  app.get("/admin/customization/definitions/:id/targets", async (request, reply) => {
    const role = await adminRole(request);
    const { id } = idSchema.parse(request.params);
    const { search } = z.object({ search: z.string().max(200).default("") }).parse(request.query);
    const definition = await prisma.customFunctionDefinition.findFirst({ where: { id, programId: request.programId, isActive: true } });
    if (!definition) throw new LoyaltyError("CUSTOMIZATION_NOT_FOUND", 404);
    await assertDefinitionAccess(request, definition, role, false);
    return reply.send({ data: definition.context === "CUSTOM" ? [] : await builtinTargets(request, definition.context, role, undefined, search) });
  });
  app.get("/admin/customization/definitions/:id/records", async (request, reply) => {
    const role = await adminRole(request);
    const { id } = idSchema.parse(request.params);
    const definition = await prisma.customFunctionDefinition.findFirst({ where: { id, programId: request.programId } });
    if (!definition) throw new LoyaltyError("CUSTOMIZATION_NOT_FOUND", 404);
    await assertDefinitionAccess(request, definition, role, false);
    const fields = fieldsFromJson(definition.fields);
    const records = await prisma.customDocument.findMany({ where: { programId: request.programId, definitionId: id, archivedAt: null }, orderBy: { updatedAt: "desc" }, take: 200 });
    const result = [];
    for (const record of records) {
      if (definition.context !== "CUSTOM" && (!record.recordId || !(await builtinTargets(request, definition.context, role, record.recordId)).length)) continue;
      result.push({ ...record, availableTransitions: allowedTransitions(definition, record, role), values: visibleValues(fields, record.values, role) });
    }
    return reply.send({ data: result });
  });
  app.post("/admin/customization/definitions/:id/records", async (request, reply) => {
    const role = await adminRole(request);
    const { id } = idSchema.parse(request.params);
    const body = recordBody.parse(request.body);
    const definition = await prisma.customFunctionDefinition.findFirst({ where: { id, programId: request.programId, isActive: true } });
    if (!definition) throw new LoyaltyError("CUSTOMIZATION_NOT_FOUND", 404);
    await assertDefinitionAccess(request, definition, role, true);
    if (definition.context !== "CUSTOM" && (!body.recordId || !(await builtinTargets(request, definition.context, role, body.recordId, "", true)).length)) throw new LoyaltyError("CUSTOMIZATION_TARGET_NOT_FOUND", 404);
    if (definition.context === "CUSTOM" && body.recordId) throw new LoyaltyError("CUSTOMIZATION_TARGET_INVALID", 400);
    const fields = fieldsFromJson(definition.fields);
    rejectHiddenWrites(fields, body.values, role);
    if (fields.some(field => field.type === "FILE" && body.values[field.key])) throw new LoyaltyError("CUSTOMIZATION_SAVE_DRAFT_BEFORE_UPLOAD", 400);
    const values = validateCustomValues(fields, body.values, {}, true);
    const initial = statesFrom(definition.states).find(state => state.initial)!;
    const record = await prisma.$transaction(async tx => {
      await pinDefinition(tx, definition);
      return tx.customDocument.create({ data: { programId: request.programId, definitionId: id, recordId: body.recordId ?? null, title: body.title, values: inputJson(values), status: initial.key, createdByAdminId: request.adminId!, updatedByAdminId: request.adminId! } });
    });
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "custom_document", record.id, { operation: "CREATE", definitionKey: definition.key, status: record.status, version: record.version, fields: Object.keys(values) });
    return reply.status(201).send({ data: { ...record, values: visibleValues(fields, record.values, role) } });
  });
  app.get("/admin/customization/records/:id", async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    const { record, definition, fields, role } = await assertCustomDocumentAccess(request, id, false);
    let canManage = false;
    try { await assertDefinitionAccess(request, definition, role, true); canManage = definition.isActive; } catch (error) { if (!(error instanceof LoyaltyError && error.httpStatus === 403)) throw error; }
    return reply.send({ data: { ...record, availableTransitions: allowedTransitions(definition, record, role), definition: { ...definition, canManage, fields: fields.filter(field => fieldVisible(field, role)) }, values: visibleValues(fields, record.values, role) } });
  });
  app.patch("/admin/customization/records/:id", async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    const body = recordBody.extend({ version: z.number().int().positive() }).parse(request.body);
    const { record, definition, fields, role } = await assertCustomDocumentAccess(request, id, true);
    if (statesFrom(definition.states).some(state => state.key === record.status && state.terminal)) throw new LoyaltyError("CUSTOM_DOCUMENT_TERMINAL", 409);
    rejectHiddenWrites(fields, body.values, role);
    const previous = jsonRecord(record.values);
    const values = validateCustomValues(fields, { ...previous, ...body.values }, previous, statesFrom(definition.states).some(state => state.key === record.status && state.initial));
    await validateFileReferences(request.programId, id, values, fields);
    const updated = await prisma.$transaction(async tx => {
      await pinDefinition(tx, definition);
      const changed = await tx.customDocument.updateMany({ where: { id, programId: request.programId, version: body.version, archivedAt: null, pendingTransition: { equals: Prisma.DbNull } }, data: { title: body.title, values: inputJson(values), version: { increment: 1 }, updatedByAdminId: request.adminId! } });
      if (changed.count !== 1) throw new LoyaltyError("CUSTOM_DOCUMENT_VERSION_CONFLICT", 409);
      const next = await tx.customDocument.findUniqueOrThrow({ where: { id } });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "custom_document", id, { operation: "UPDATE", version: next.version, fields: Object.keys(body.values) }, undefined, tx);
      return next;
    });
    return reply.send({ data: { ...updated, values: visibleValues(fields, updated.values, role) } });
  });
  app.delete("/admin/customization/records/:id", async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    const { record, definition } = await assertCustomDocumentAccess(request, id, true);
    if (!statesFrom(definition.states).some(state => state.key === record.status && state.initial)) throw new LoyaltyError("CUSTOM_DOCUMENT_NOT_ARCHIVABLE", 409);
    const changed = await prisma.customDocument.updateMany({ where: { id, programId: request.programId, version: record.version, pendingTransition: { equals: Prisma.DbNull }, archivedAt: null }, data: { archivedAt: new Date(), version: { increment: 1 }, updatedByAdminId: request.adminId! } });
    if (!changed.count) throw new LoyaltyError("CUSTOM_DOCUMENT_VERSION_CONFLICT", 409);
    await audit(request.programId, request.actor, "CONFIG_CHANGE", "custom_document", id, { operation: "ARCHIVE" });
    return reply.status(204).send();
  });
  app.post("/admin/customization/records/:id/transitions", async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    const body = z.object({ transitionKey: z.string().min(1), version: z.number().int().positive() }).parse(request.body);
    const { record, definition, fields, role } = await assertCustomDocumentAccess(request, id, true);
    if (definition.context !== "CUSTOM") throw new LoyaltyError("CUSTOMIZATION_BUILTIN_WORKFLOW_PROTECTED", 400);
    const transition = definitionSchema.shape.transitions.parse(definition.transitions).find(item => item.key === body.transitionKey && item.from === record.status);
    if (!transition || !roleAllowed(transition.roles, role)) throw new LoyaltyError("CUSTOMIZATION_TRANSITION_NOT_ALLOWED", 403);
    const values = validateCustomValues(fields, jsonRecord(record.values));
    await validateFileReferences(request.programId, id, values, fields);
    const result = await prisma.$transaction(async tx => {
      await pinDefinition(tx, definition);
      const lock = await tx.customDocument.updateMany({ where: { id, programId: request.programId, version: body.version, archivedAt: null, pendingTransition: { equals: Prisma.DbNull } }, data: { version: { increment: 1 }, updatedByAdminId: request.adminId! } });
      if (lock.count !== 1) throw new LoyaltyError("CUSTOM_DOCUMENT_VERSION_CONFLICT", 409);
      if (transition.workflowId) {
        const publicFields = fields.filter(field => !field.readRoles.length);
        const publicValues = visibleValues(publicFields, values, role);
        const evidence = publicFields.filter(field => field.type === "FILE").flatMap(field => publicValues[field.key] ? [publicValues[field.key]] : []);
        const approval = await createApprovalRequestWithClient(tx, {
          programId: request.programId, actionKey: "CUSTOM_DOCUMENT_APPROVAL", workflowId: transition.workflowId,
          requestedByType: "ADMIN_USER", requestedById: request.adminId!, requesterAdminId: request.adminId!,
          subjectType: "CustomDocument", subjectId: id, idempotencyKey: `custom-document:${id}:${body.version}:${transition.key}`,
          payload: inputJson({ documentId: id, documentTitle: record.title, definitionKey: definition.key, definitionName: definition.name, transitionKey: transition.key, fromState: transition.from, toState: transition.to, fields: publicValues, evidence }),
          scopeContext: { attributes: { definitionKey: definition.key, transitionKey: transition.key } },
        });
        if (!approval) throw new LoyaltyError("CUSTOMIZATION_WORKFLOW_INVALID", 409);
        await tx.customDocument.update({ where: { id }, data: { approvalRequestId: approval.id, pendingTransition: inputJson({ ...transition, approvalRequestId: approval.id }) } });
      } else await tx.customDocument.update({ where: { id }, data: { status: transition.to } });
      const next = await tx.customDocument.findUniqueOrThrow({ where: { id } });
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "custom_document", id, { operation: transition.workflowId ? "SUBMIT_TRANSITION" : "TRANSITION", from: transition.from, to: transition.to, version: next.version, approvalRequestId: next.approvalRequestId }, undefined, tx);
      return next;
    });
    if (result.pendingTransition && result.approvalRequestId) await notifyApprovalAssignees(request.programId, result.approvalRequestId).catch(error => request.log.warn({ err: error, approvalRequestId: result.approvalRequestId }, "Failed to notify custom-document approvers"));
    return reply.send({ data: { ...result, values: visibleValues(fields, result.values, role) } });
  });
  app.get("/admin/customization/records/:id/history", async (request, reply) => {
    const { id } = idSchema.parse(request.params);
    await assertCustomDocumentAccess(request, id, false);
    return reply.send({ data: await prisma.approvalRequest.findMany({ where: { programId: request.programId, subjectType: "CustomDocument", subjectId: id }, orderBy: { requestedAt: "desc" }, take: 100, select: { id: true, status: true, requestedAt: true, resolvedAt: true, resolutionComment: true, steps: { orderBy: { stepOrder: "asc" }, select: { name: true, status: true } }, decisions: { orderBy: { createdAt: "asc" }, select: { decision: true, comment: true, createdAt: true, approver: { select: { name: true } } } } } }) });
  });
  done();
}
