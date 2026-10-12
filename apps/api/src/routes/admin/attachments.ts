import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { assertCustomDocumentAccess, visibleValues } from "../../lib/customization.js";
import { LoyaltyError } from "../../lib/errors.js";
import { assertCapability } from "../../lib/permissions.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_CONTEXT_FILES = 50;
const MAX_CONTEXT_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

const MIME_PROFILES = {
  "application/pdf": { extensions: ["pdf"], extension: "pdf" },
  "image/jpeg": { extensions: ["jpg", "jpeg"], extension: "jpg" },
  "image/png": { extensions: ["png"], extension: "png" },
  "image/webp": { extensions: ["webp"], extension: "webp" },
  "text/plain": { extensions: ["txt", "text", "log", "md"], extension: "txt" },
  "text/csv": { extensions: ["csv"], extension: "csv" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { extensions: ["xlsx"], extension: "xlsx" },
} as const;

type AttachmentMimeType = keyof typeof MIME_PROFILES;

const uploadSchema = z.object({
  contextType: z.enum(["PROJECT", "CUSTOM_DOCUMENT"]),
  contextId: z.string().trim().min(1).max(200),
  name: z.string().min(1).max(1000),
  mimeType: z.string().trim().toLowerCase().max(120),
  base64: z.string().min(1).max(MAX_REQUEST_BYTES),
}).strict();

function sessionAdminId(request: FastifyRequest): string {
  if (!request.adminId) throw new LoyaltyError("ADMIN_SESSION_REQUIRED", 403);
  return request.adminId;
}

function isForbidden(error: unknown): boolean {
  return error instanceof LoyaltyError && error.httpStatus === 403;
}

async function hasCapability(request: FastifyRequest, capability: Parameters<typeof assertCapability>[1]): Promise<boolean> {
  try {
    await assertCapability(request, capability);
    return true;
  } catch (error) {
    if (isForbidden(error)) return false;
    throw error;
  }
}

function safeName(input: string, mimeType: AttachmentMimeType): string {
  const profile = MIME_PROFILES[mimeType];
  const leaf = input.replace(/\\/g, "/").split("/").at(-1) ?? "";
  let name = leaf
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[\\/]/g, "_")
    .trim()
    .replace(/[. ]+$/g, "");
  if (!name || name === "." || name === "..") throw new LoyaltyError("ATTACHMENT_NAME_INVALID", 400);
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (!extension) name += `.${profile.extension}`;
  else if (!(profile.extensions as readonly string[]).includes(extension)) throw new LoyaltyError("ATTACHMENT_MIME_EXTENSION_MISMATCH", 400);
  if (name.length > 180) {
    const ext = name.slice(name.lastIndexOf("."));
    name = `${name.slice(0, 180 - ext.length)}${ext}`;
  }
  return name;
}

function decodeBase64(input: string): Buffer {
  if (input.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)) {
    throw new LoyaltyError("ATTACHMENT_BASE64_INVALID", 400);
  }
  const bytes = Buffer.from(input, "base64");
  if (!bytes.length || bytes.length > MAX_FILE_BYTES || bytes.toString("base64") !== input) {
    throw new LoyaltyError(bytes.length > MAX_FILE_BYTES ? "ATTACHMENT_TOO_LARGE" : "ATTACHMENT_BASE64_INVALID", 400);
  }
  return bytes;
}

function zipEntryNames(bytes: Buffer): string[] | null {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) return null;
  const min = Math.max(0, bytes.length - 65_557);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= min; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      const commentLength = bytes.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === bytes.length) {
        endOffset = offset;
        break;
      }
    }
  }
  if (endOffset < 0) return null;
  const entryCount = bytes.readUInt16LE(endOffset + 10);
  const centralSize = bytes.readUInt32LE(endOffset + 12);
  let offset = bytes.readUInt32LE(endOffset + 16);
  if (entryCount === 0 || entryCount > 2000 || offset + centralSize > endOffset) return null;
  const names: string[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > endOffset || bytes.readUInt32LE(offset) !== 0x02014b50) return null;
    const flags = bytes.readUInt16LE(offset + 8);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (flags & 0x0001 || next > endOffset) return null;
    names.push(bytes.toString("utf8", offset + 46, offset + 46 + nameLength));
    offset = next;
  }
  return names;
}

function validateFileBytes(mimeType: AttachmentMimeType, bytes: Buffer): void {
  const startsWith = (signature: number[]) => signature.every((value, index) => bytes[index] === value);
  if (mimeType === "application/pdf") {
    if (bytes.length < 12 || bytes.toString("ascii", 0, 5) !== "%PDF-" || !bytes.toString("latin1", Math.max(0, bytes.length - 1024)).includes("%%EOF")) {
      throw new LoyaltyError("ATTACHMENT_CONTENT_INVALID", 400);
    }
    const head = bytes.toString("latin1");
    if (/\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b/.test(head)) throw new LoyaltyError("ATTACHMENT_ACTIVE_CONTENT_NOT_ALLOWED", 400);
    return;
  }
  if (mimeType === "image/jpeg") {
    if (bytes.length < 4 || !startsWith([0xff, 0xd8, 0xff]) || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
      throw new LoyaltyError("ATTACHMENT_CONTENT_INVALID", 400);
    }
    return;
  }
  if (mimeType === "image/png") {
    if (bytes.length < 20 || !startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || bytes.toString("ascii", bytes.length - 8, bytes.length - 4) !== "IEND") {
      throw new LoyaltyError("ATTACHMENT_CONTENT_INVALID", 400);
    }
    return;
  }
  if (mimeType === "image/webp") {
    if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length) {
      throw new LoyaltyError("ATTACHMENT_CONTENT_INVALID", 400);
    }
    return;
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    const names = zipEntryNames(bytes);
    if (!names?.includes("[Content_Types].xml") || !names.includes("xl/workbook.xml") || names.some((name) => /(^|\/)(?:vbaProject\.bin|externalLinks\/|embeddings\/)/i.test(name))) {
      throw new LoyaltyError("ATTACHMENT_CONTENT_INVALID", 400);
    }
    return;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LoyaltyError("ATTACHMENT_CONTENT_INVALID", 400);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) || /^\s*(?:#!|<\s*!doctype\s+html|<\s*html\b|<\s*script\b|<\?xml)/i.test(text)) {
    throw new LoyaltyError("ATTACHMENT_ACTIVE_CONTENT_NOT_ALLOWED", 400);
  }
  if (mimeType === "text/csv" && text.includes("\u0000")) throw new LoyaltyError("ATTACHMENT_CONTENT_INVALID", 400);
}

function containsFileReference(value: unknown, attachmentId: string): boolean {
  if (Array.isArray(value)) return value.some((item) => containsFileReference(item, attachmentId));
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "FILE" && record.attachmentId === attachmentId) return true;
  return Object.values(record).some((item) => containsFileReference(item, attachmentId));
}

function adminAssigned(request: { adminId: string | null }, steps: { assigneesSnapshot: unknown; decisions: { approverAdminId: string }[] }[]): boolean {
  const adminId = request.adminId;
  if (!adminId) return false;
  return steps.some((step) => {
    const assignees = Array.isArray(step.assigneesSnapshot) ? step.assigneesSnapshot : [];
    const wasAssigned = assignees.some((item) => item && typeof item === "object" && (item as Record<string, unknown>).adminId === adminId);
    return wasAssigned || step.decisions.some((decision) => decision.approverAdminId === adminId);
  });
}

async function isProjectApprovalReviewer(request: FastifyRequest, projectId: string, attachmentId: string): Promise<boolean> {
  const adminId = sessionAdminId(request);
  const canViewApproval = await hasCapability(request, "approval.view");
  if (!canViewApproval) return false;
  const batches = await prisma.projectIssueBatch.findMany({ where: { projectId }, select: { id: true } });
  const approvals = await prisma.approvalRequest.findMany({
    where: {
      programId: request.programId,
      OR: [
        { actionKey: "PROJECT_PLAN_APPROVAL", subjectType: "Project", subjectId: projectId },
        ...(batches.length ? [{ actionKey: "PROJECT_POINT_ISSUANCE", subjectType: "ProjectIssueBatch", subjectId: { in: batches.map((batch) => batch.id) } }] : []),
      ],
    },
    select: {
      payload: true,
      steps: { select: { assigneesSnapshot: true, decisions: { select: { approverAdminId: true } } } },
    },
  });
  return approvals.some((approval) =>
    containsFileReference(approval.payload, attachmentId) && adminAssigned({ adminId }, approval.steps),
  );
}

async function isCustomDocumentApprovalReviewer(request: FastifyRequest, contextId: string, attachmentId: string): Promise<boolean> {
  const adminId = sessionAdminId(request);
  const canViewApproval = await hasCapability(request, "approval.view");
  if (!canViewApproval) return false;
  const approvals = await prisma.approvalRequest.findMany({
    where: { programId: request.programId, subjectId: contextId, subjectType: "CustomDocument" },
    select: {
      payload: true,
      steps: { select: { assigneesSnapshot: true, decisions: { select: { approverAdminId: true } } } },
    },
  });
  return approvals.some((approval) =>
    containsFileReference(approval.payload, attachmentId) && adminAssigned({ adminId }, approval.steps),
  );
}

async function canReadProjectAttachment(request: FastifyRequest, attachment: { id: string; contextId: string }): Promise<boolean> {
  const adminId = sessionAdminId(request);
  const project = await prisma.project.findFirst({
    where: { id: attachment.contextId, programId: request.programId },
    select: { id: true, createdByAdminId: true },
  });
  if (!project) return false;
  if (project.createdByAdminId === adminId && await hasCapability(request, "project.view")) return true;
  if (await hasCapability(request, "project.view") && await hasCapability(request, "project.finance.view")) return true;
  return isProjectApprovalReviewer(request, project.id, attachment.id);
}

async function canReadCustomDocumentAttachment(
  request: FastifyRequest,
  attachment: { id: string; contextId: string; uploadedByAdminId: string },
): Promise<boolean> {
  const adminId = sessionAdminId(request);
  try {
    const { record, fields, role } = await assertCustomDocumentAccess(request, attachment.contextId, false);
    const allValues = record.values && typeof record.values === "object" && !Array.isArray(record.values)
      ? record.values as Record<string, unknown>
      : {};
    const visible = visibleValues(fields, allValues, role);
    if (containsFileReference(visible, attachment.id)) return true;
    if (attachment.uploadedByAdminId === adminId && !containsFileReference(allValues, attachment.id)) return true;
  } catch (error) {
    if (!isForbidden(error)) throw error;
    if (attachment.uploadedByAdminId === adminId) {
      const record = await prisma.customDocument.findFirst({
        where: { id: attachment.contextId, programId: request.programId, archivedAt: null },
        select: { id: true, values: true },
      });
      const values = record?.values && typeof record.values === "object" && !Array.isArray(record.values)
        ? record.values as Record<string, unknown>
        : {};
      if (record && !containsFileReference(values, attachment.id)) return true;
    }
  }
  return isCustomDocumentApprovalReviewer(request, attachment.contextId, attachment.id);
}

function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function failHiddenAttachment(): never {
  throw new LoyaltyError("ATTACHMENT_NOT_FOUND", 404);
}

export function adminAttachmentRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.post(
    "/admin/attachments",
    { bodyLimit: MAX_REQUEST_BYTES, preHandler: [async (request) => { sessionAdminId(request); }] },
    async (request, reply) => {
      const adminId = sessionAdminId(request);
      const body = uploadSchema.parse(request.body);
      const mimeType = body.mimeType as AttachmentMimeType;
      if (!Object.hasOwn(MIME_PROFILES, mimeType)) throw new LoyaltyError("ATTACHMENT_MIME_NOT_ALLOWED", 400);
      const name = safeName(body.name, mimeType);
      const bytes = decodeBase64(body.base64);
      validateFileBytes(mimeType, bytes);

      if (body.contextType === "PROJECT") {
        await assertCapability(request, "project.manage");
        const project = await prisma.project.findFirst({
          where: { id: body.contextId, programId: request.programId },
          select: { id: true, status: true, createdByAdminId: true },
        });
        if (!project || project.createdByAdminId !== adminId) failHiddenAttachment();
        if (["CLOSED", "PLAN_PENDING", "ISSUE_PENDING"].includes(project.status)) throw new LoyaltyError("ATTACHMENT_CONTEXT_LOCKED", 409);
      } else {
        await assertCustomDocumentAccess(request, body.contextId, true);
      }

      const metadata = await prisma.$transaction(async (tx) => {
        const where = { programId: request.programId, contextType: body.contextType, contextId: body.contextId };
        const existing = await tx.customAttachment.findMany({ where, select: { size: true } });
        const usedBytes = existing.reduce((sum, attachment) => sum + attachment.size, 0);
        if (existing.length >= MAX_CONTEXT_FILES) throw new LoyaltyError("ATTACHMENT_CONTEXT_FILE_LIMIT", 409);
        if (usedBytes + bytes.byteLength > MAX_CONTEXT_BYTES) throw new LoyaltyError("ATTACHMENT_CONTEXT_SIZE_LIMIT", 409);
        const created = await tx.customAttachment.create({
          data: {
            ...where,
            name,
            mimeType,
            size: bytes.byteLength,
            base64: bytes.toString("base64"),
            uploadedByAdminId: adminId,
          },
          select: { id: true, name: true, mimeType: true, size: true },
        });
        await audit(request.programId, request.actor, "CONFIG_CHANGE", "custom_attachment", created.id, { operation: "UPLOAD", contextType: body.contextType, contextId: body.contextId, name: created.name, mimeType: created.mimeType, size: created.size }, undefined, tx);
        return created;
      }, { isolationLevel: "Serializable" });
      return reply.status(201).send({ data: metadata });
    },
  );

  app.get(
    "/admin/attachments/:id",
    { preHandler: [async (request) => { sessionAdminId(request); }] },
    async (request, reply) => {
      sessionAdminId(request);
      const { id } = z.object({ id: z.string().trim().min(1).max(200) }).parse(request.params);
      const attachment = await prisma.customAttachment.findFirst({
        where: { id, programId: request.programId },
        select: { id: true, name: true, mimeType: true, size: true, contextType: true, contextId: true, uploadedByAdminId: true },
      });
      if (!attachment || !Object.hasOwn(MIME_PROFILES, attachment.mimeType)) failHiddenAttachment();

      let authorized = false;
      if (attachment.contextType === "PROJECT") authorized = await canReadProjectAttachment(request, attachment);
      else if (attachment.contextType === "CUSTOM_DOCUMENT") authorized = await canReadCustomDocumentAttachment(request, attachment);
      if (!authorized) failHiddenAttachment();

      const stored = await prisma.customAttachment.findFirst({
        where: { id: attachment.id, programId: request.programId },
        select: { base64: true, size: true },
      });
      if (!stored) failHiddenAttachment();
      const bytes = Buffer.from(stored.base64, "base64");
      if (bytes.length !== stored.size || bytes.length !== attachment.size || bytes.length > MAX_FILE_BYTES) {
        throw new LoyaltyError("ATTACHMENT_CONTENT_INVALID", 500);
      }
      return sendPrivateAttachment(reply, attachment.name, attachment.mimeType as AttachmentMimeType, bytes);
    },
  );

  done();
}

function sendPrivateAttachment(reply: FastifyReply, name: string, mimeType: AttachmentMimeType, bytes: Buffer) {
  return reply
    .header("Content-Type", mimeType)
    .header("Content-Disposition", contentDisposition(name))
    .header("Content-Length", String(bytes.byteLength))
    .header("Cache-Control", "private, no-store")
    .header("X-Content-Type-Options", "nosniff")
    .header("Cross-Origin-Resource-Policy", "same-origin")
    .send(bytes);
}
