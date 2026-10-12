import type { Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { LoyaltyError } from "./errors.js";
import { assertCapability, type AdminCapability } from "./permissions.js";

export const CUSTOM_CONTEXTS: { key: string; label: string; readCapability: AdminCapability; writeCapability: AdminCapability }[] = [
  { key: "MEMBER", label: "Members", readCapability: "member.view", writeCapability: "member.manage" },
  { key: "PROJECT", label: "Projects", readCapability: "project.view", writeCapability: "project.manage" },
  { key: "PROJECT_DISTRIBUTION", label: "Project distributions", readCapability: "project.finance.view", writeCapability: "project.manage" },
  { key: "CAMPAIGN", label: "Campaigns", readCapability: "campaign.view", writeCapability: "campaign.manage" },
  { key: "REWARD", label: "Rewards", readCapability: "reward.view", writeCapability: "reward.manage" },
  { key: "REWARD_REDEMPTION", label: "Reward redemptions", readCapability: "reward.view", writeCapability: "reward.manage" },
  { key: "COUPON", label: "Coupons", readCapability: "coupon.view", writeCapability: "coupon.manage" },
  { key: "SEGMENT", label: "Segments", readCapability: "segment.view", writeCapability: "segment.manage" },
  { key: "TIER", label: "Tiers", readCapability: "tier.view", writeCapability: "tier.manage" },
  { key: "BADGE", label: "Badges", readCapability: "badge.view", writeCapability: "badge.manage" },
  { key: "EVENT", label: "Event definitions", readCapability: "event.view", writeCapability: "event.manage" },
  { key: "POINT_TYPE", label: "Point types", readCapability: "point_type.view", writeCapability: "point_type.manage" },
  { key: "POINT_RULE", label: "Issuance rules", readCapability: "issuance.view", writeCapability: "issuance.manage" },
  { key: "WORKFLOW", label: "Workflows", readCapability: "workflow.view", writeCapability: "workflow.manage" },
  { key: "BANK_CYCLE", label: "Bank cycles", readCapability: "bank.view", writeCapability: "bank.manage" },
  { key: "EXCHANGE_RATE", label: "Exchange rates", readCapability: "exchange.view", writeCapability: "exchange.manage" },
  { key: "EXCHANGE_REQUEST", label: "Exchange vouchers", readCapability: "exchange.view", writeCapability: "exchange.manage" },
  { key: "NOTIFICATION_TEMPLATE", label: "Notification templates", readCapability: "notification.view", writeCapability: "notification.manage" },
  { key: "RECOGNITION_CATEGORY", label: "Recognition categories", readCapability: "recognition.view", writeCapability: "recognition.manage" },
  { key: "DOCUMENTATION", label: "Documentation", readCapability: "documentation.view", writeCapability: "documentation.manage" },
];

const keySchema = z.string().trim().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/)
  .refine(value => !["constructor", "prototype"].includes(value), "Reserved key");
const roleList = z.array(z.string().trim().min(1).max(80)).max(100);
export const customFieldSchema = z.object({
  key: keySchema,
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  type: z.enum(["TEXT", "LONG_TEXT", "NUMBER", "BOOLEAN", "DATE", "DATETIME", "SELECT", "MULTI_SELECT", "EMAIL", "URL", "FILE"]),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  sortOrder: z.number().int().min(0).max(10000).default(0),
  readRoles: roleList.default([]),
  isActive: z.boolean().default(true),
});
const stateSchema = z.object({ key: z.string().regex(/^[A-Z][A-Z0-9_]{0,59}$/), label: z.string().trim().min(1).max(160), initial: z.boolean().default(false), terminal: z.boolean().default(false) });
export const transitionSchema = z.object({
  key: keySchema, label: z.string().trim().min(1).max(160), from: stateSchema.shape.key, to: stateSchema.shape.key,
  roles: roleList.min(1), workflowId: z.string().min(1).nullable().optional(),
});
export const definitionSchema = z.object({
  key: keySchema, name: z.string().trim().min(1).max(160), description: z.string().trim().max(5000).nullable().optional(),
  context: z.string().refine(value => value === "CUSTOM" || CUSTOM_CONTEXTS.some(context => context.key === value)),
  fields: z.array(customFieldSchema).max(100).default([]),
  states: z.array(stateSchema).min(1).max(30), transitions: z.array(transitionSchema).max(100).default([]),
  readRoles: roleList.min(1).default(["SUPER_ADMIN"]), writeRoles: roleList.min(1).default(["SUPER_ADMIN"]),
  isActive: z.boolean().default(true),
});
export type CustomField = z.infer<typeof customFieldSchema>;
export type CustomTransition = z.infer<typeof transitionSchema>;
export type CustomDefinitionInput = z.infer<typeof definitionSchema>;
export const jsonRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const roleAllowed = (roles: readonly string[], role: string): boolean => role === "SUPER_ADMIN" || roles.includes(role);
export function fieldsFromJson(value: unknown): CustomField[] {
  return z.array(customFieldSchema).parse(value).sort((a, b) => a.sortOrder - b.sortOrder);
}
export function fieldVisible(field: CustomField, role: string): boolean {
  return !field.readRoles.length || roleAllowed(field.readRoles, role);
}
export function validateDefinition(input: CustomDefinitionInput): void {
  for (const items of [input.fields, input.states, input.transitions]) {
    if (new Set(items.map(item => item.key)).size !== items.length) throw new LoyaltyError("CUSTOMIZATION_DUPLICATE_KEY", 400);
  }
  if (input.states.filter(state => state.initial).length !== 1) throw new LoyaltyError("CUSTOMIZATION_INITIAL_STATE_REQUIRED", 400);
  if (input.states.some(state => state.initial && state.terminal)) throw new LoyaltyError("CUSTOMIZATION_INITIAL_STATE_CANNOT_BE_TERMINAL", 400);
  const states = new Map(input.states.map(state => [state.key, state]));
  for (const transition of input.transitions) {
    if (!states.has(transition.from) || !states.has(transition.to) || states.get(transition.from)?.terminal || transition.from === transition.to)
      throw new LoyaltyError("CUSTOMIZATION_TRANSITION_INVALID", 400);
    if (transition.roles.some(role => !input.writeRoles.includes(role) && role !== "SUPER_ADMIN")) throw new LoyaltyError("CUSTOMIZATION_TRANSITION_ROLE_INVALID", 400);
  }
  if (input.context !== "CUSTOM" && input.transitions.length) throw new LoyaltyError("CUSTOMIZATION_BUILTIN_WORKFLOW_PROTECTED", 400);
  for (const field of input.fields) {
    if (["SELECT", "MULTI_SELECT"].includes(field.type) && !field.options.length) throw new LoyaltyError("CUSTOMIZATION_OPTIONS_REQUIRED", 400, { field: field.label });
    if (new Set(field.options).size !== field.options.length) throw new LoyaltyError("CUSTOMIZATION_DUPLICATE_OPTION", 400);
    if (field.required && field.readRoles.length && input.writeRoles.some(role => !fieldVisible(field, role)))
      throw new LoyaltyError("CUSTOMIZATION_REQUIRED_FIELD_HIDDEN", 400, { field: field.label });
  }
}

export function validateCustomValues(fields: CustomField[], input: Record<string, unknown>, previous: Record<string, unknown> = {}, draft = false): Record<string, unknown> {
  const definitions = new Map(fields.map(field => [field.key, field]));
  const result: [string, unknown][] = [];
  for (const [key, value] of Object.entries(input)) {
    const field = definitions.get(key);
    if ((!field || !field.isActive) && (!Object.prototype.hasOwnProperty.call(previous, key) || JSON.stringify(value) !== JSON.stringify(previous[key])))
      throw new LoyaltyError("CUSTOMIZATION_FIELD_UNKNOWN_OR_ARCHIVED", 400, { field: key });
    if (!field || !field.isActive) result.push([key, value]);
  }
  for (const field of fields.filter(field => field.isActive)) {
    const raw = Object.prototype.hasOwnProperty.call(input, field.key) ? input[field.key] : undefined;
    const value = field.type === "BOOLEAN" && raw === undefined ? false : raw;
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) {
      if (field.required && !draft) throw new LoyaltyError("CUSTOMIZATION_FIELD_REQUIRED", 400, { field: field.label });
      if (value !== undefined) result.push([field.key, value]);
      continue;
    }
    let valid = true;
    switch (field.type) {
      case "TEXT": case "LONG_TEXT": valid = typeof value === "string" && value.length <= (field.type === "TEXT" ? 5000 : 20000); break;
      case "NUMBER": valid = typeof value === "number" && Number.isFinite(value); break;
      case "BOOLEAN": valid = typeof value === "boolean"; break;
      case "DATE": valid = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; break;
      case "DATETIME": valid = z.string().datetime({ offset: true }).safeParse(value).success; break;
      case "EMAIL": valid = z.string().email().max(320).safeParse(value).success; break;
      case "URL": valid = typeof value === "string" && value.length <= 2000 && safeHttpUrl(value); break;
      case "SELECT": valid = typeof value === "string" && field.options.includes(value); break;
      case "MULTI_SELECT": valid = Array.isArray(value) && value.length <= field.options.length && new Set(value).size === value.length && value.every(item => typeof item === "string" && field.options.includes(item)); break;
      case "FILE": { const file = jsonRecord(value); valid = file.kind === "FILE" && typeof file.attachmentId === "string" && file.attachmentId.length > 0 && file.attachmentId.length <= 200 && Object.keys(file).every(key => ["kind", "attachmentId", "name"].includes(key)) && (file.name === undefined || typeof file.name === "string" && file.name.length <= 180); break; }
    }
    if (!valid) throw new LoyaltyError("CUSTOMIZATION_FIELD_INVALID", 400, { field: field.label });
    result.push([field.key, field.type === "FILE" ? { kind: "FILE", attachmentId: jsonRecord(value).attachmentId, ...(jsonRecord(value).name ? { name: jsonRecord(value).name } : {}) } : value]);
  }
  const values = Object.fromEntries(result);
  if (JSON.stringify(values).length > 200000) throw new LoyaltyError("CUSTOMIZATION_VALUES_TOO_LARGE", 400);
  return values;
}
export function safeHttpUrl(value: string): boolean {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
export async function validateConfiguredValues(programId: string, context: string, input: Record<string, unknown>, access?: { role: string; adminId: string; projectId: string }): Promise<Record<string, unknown>> {
  const definitions = await prisma.customFunctionDefinition.findMany({ where: { programId, context, isActive: true }, select: { fields: true, readRoles: true } });
  if (access && definitions.some(definition => !roleAllowed(definition.readRoles, access.role))) throw new LoyaltyError("CUSTOMIZATION_ACCESS_DENIED", 403);
  const fields = definitions.flatMap(definition => fieldsFromJson(definition.fields));
  if (access && fields.some(field => !fieldVisible(field, access.role) && Object.prototype.hasOwnProperty.call(input, field.key))) throw new LoyaltyError("CUSTOMIZATION_FIELD_ACCESS_DENIED", 403);
  const values = validateCustomValues(access ? fields.filter(field => fieldVisible(field, access.role)) : fields, input);
  const ids = fields.filter(field => field.type === "FILE").flatMap(field => { const file = jsonRecord(values[field.key]); return typeof file.attachmentId === "string" ? [file.attachmentId] : []; });
  if (ids.length) {
    if (!access || context !== "PROJECT_DISTRIBUTION") throw new LoyaltyError("CUSTOMIZATION_FILE_INVALID", 400);
    const found = await prisma.customAttachment.count({ where: { id: { in: [...new Set(ids)] }, programId, contextType: "PROJECT", contextId: access.projectId, uploadedByAdminId: access.adminId } });
    if (found !== new Set(ids).size) throw new LoyaltyError("CUSTOMIZATION_FILE_INVALID", 400);
  }
  return values;
}
export async function configuredVisibleValues(programId: string, context: string, values: unknown, role?: string, publicOnly = false): Promise<Record<string, unknown>> {
  const definitions = await prisma.customFunctionDefinition.findMany({ where: { programId, context, isActive: true }, select: { fields: true, readRoles: true } });
  const fields = definitions.filter(definition => publicOnly || !role || roleAllowed(definition.readRoles, role)).flatMap(definition => fieldsFromJson(definition.fields));
  return visibleValues(publicOnly ? fields.filter(field => !field.readRoles.length) : fields, values, role ?? "SUPER_ADMIN");
}

/** Values visible to one role; hidden fields do not leak through API responses. */
export function visibleValues(fields: CustomField[], values: unknown, role: string): Record<string, unknown> {
  const original = jsonRecord(values);
  return Object.fromEntries(fields.filter(field => field.isActive && fieldVisible(field, role) && Object.prototype.hasOwnProperty.call(original, field.key)).map(field => [field.key, original[field.key]]));
}
export function inputJson(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }

export async function adminRole(request: Pick<FastifyRequest, "adminId" | "programId">): Promise<string> {
  if (!request.adminId) throw new LoyaltyError("ADMIN_SESSION_REQUIRED", 403);
  const admin = await prisma.adminUser.findFirst({ where: { id: request.adminId, programId: request.programId, isActive: true }, select: { role: true } });
  if (!admin) throw new LoyaltyError("ADMIN_SESSION_REQUIRED", 403);
  return admin.role;
}
export async function assertDefinitionAccess(request: FastifyRequest, definition: { context: string; readRoles: string[]; writeRoles: string[] }, role: string, write: boolean): Promise<void> {
  await assertCapability(request, write ? "custom_document.manage" : "custom_document.view");
  if (!roleAllowed(write ? definition.writeRoles : definition.readRoles, role)) throw new LoyaltyError("CUSTOMIZATION_ACCESS_DENIED", 403);
  if (definition.context !== "CUSTOM") {
    const context = CUSTOM_CONTEXTS.find(item => item.key === definition.context);
    if (!context) throw new LoyaltyError("CUSTOMIZATION_CONTEXT_INVALID", 400);
    // A PM's own distribution is checked by the target resolver, not the global finance grant.
    if (definition.context !== "PROJECT_DISTRIBUTION" || write) await assertCapability(request, write ? context.writeCapability : context.readCapability);
    else await assertCapability(request, "project.view");
  }
}

const builtinModels: Record<string, string> = {
  MEMBER: "member", PROJECT: "project", PROJECT_DISTRIBUTION: "projectIssueBatch", CAMPAIGN: "campaign", REWARD: "reward",
  REWARD_REDEMPTION: "rewardRedemption", COUPON: "coupon", SEGMENT: "segment", TIER: "tier", BADGE: "badge", EVENT: "eventDefinition",
  POINT_TYPE: "pointTypeDefinition", POINT_RULE: "pointRule", WORKFLOW: "approvalWorkflow", BANK_CYCLE: "pointBankCycle",
  EXCHANGE_RATE: "pointExchangeRate", EXCHANGE_REQUEST: "pointExchangeRequest", NOTIFICATION_TEMPLATE: "notificationTemplate",
  RECOGNITION_CATEGORY: "creditCategory", DOCUMENTATION: "documentationArticle",
};
type TargetDelegate = { findMany(args: { where: Record<string, unknown>; take: number; orderBy: { id: "asc" } }): Promise<Record<string, unknown>[]> };
export async function builtinTargets(request: FastifyRequest, context: string, _role: string, id?: string, search = "", write = false): Promise<{ id: string; title: string }[]> {
  const model = builtinModels[context];
  if (!model) throw new LoyaltyError("CUSTOMIZATION_CONTEXT_INVALID", 400);
  const scope = CUSTOM_CONTEXTS.find(item => item.key === context)!;
  if (context !== "PROJECT_DISTRIBUTION") await assertCapability(request, write ? scope.writeCapability : scope.readCapability);
  let finance = false;
  if (context === "PROJECT" || context === "PROJECT_DISTRIBUTION") {
    await assertCapability(request, write ? "project.manage" : "project.view");
    try { await assertCapability(request, "project.finance.view"); finance = true; } catch (error) { if (!(error instanceof LoyaltyError && error.httpStatus === 403)) throw error; }
  }
  const projectScope = { programId: request.programId, ...(!finance || write ? { createdByAdminId: request.adminId } : {}) };
  const where: Record<string, unknown> = context === "PROJECT_DISTRIBUTION" ? { project: projectScope }
    : context === "REWARD_REDEMPTION" ? { reward: { programId: request.programId } }
    : context === "PROJECT" ? projectScope : { programId: request.programId };
  if (id) where.id = id;
  if (["MEMBER", "CAMPAIGN", "COUPON", "REWARD"].includes(context)) where.deletedAt = null;
  const rows = await (prisma as unknown as Record<string, TargetDelegate>)[model]!.findMany({ where, take: id ? 1 : 500, orderBy: { id: "asc" } });
  const needle = search.toLocaleLowerCase();
  return rows.map(row => {
    const person = [row.firstName, row.lastName].filter(Boolean).join(" ");
    const title = String(row.name ?? row.title ?? row.documentNumber ?? row.code ?? (person || row.email) ?? row.eventType ?? row.label ?? (row.startsAt instanceof Date ? `${scope.label} · ${row.startsAt.toISOString().slice(0, 10)}` : `${scope.label} · ${row.createdAt instanceof Date ? row.createdAt.toISOString().slice(0, 10) : "Record"}`));
    return { id: String(row.id), title };
  }).filter(row => !needle || row.title.toLocaleLowerCase().includes(needle) || row.id.includes(needle));
}
export async function assertCustomDocumentAccess(request: FastifyRequest, id: string, write: boolean) {
  const role = await adminRole(request);
  const record = await prisma.customDocument.findFirst({ where: { id, programId: request.programId, archivedAt: null }, include: { definition: true } });
  if (!record) throw new LoyaltyError("CUSTOM_DOCUMENT_NOT_FOUND", 404);
  await assertDefinitionAccess(request, record.definition, role, write);
  if (write && (!record.definition.isActive || record.pendingTransition !== null)) throw new LoyaltyError("CUSTOM_DOCUMENT_LOCKED", 409);
  if (record.definition.context !== "CUSTOM") {
    if (!record.recordId || !(await builtinTargets(request, record.definition.context, role, record.recordId, "", write)).length) throw new LoyaltyError("CUSTOMIZATION_TARGET_NOT_FOUND", 404);
  }
  return { record, definition: record.definition, fields: fieldsFromJson(record.definition.fields), role };
}
