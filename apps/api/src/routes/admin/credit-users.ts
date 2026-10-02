import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { LoyaltyError } from "../../lib/errors.js";
import { hashMemberPassword, validateMemberUsername } from "../../lib/member-auth.js";
import { issueOnboardingForMember } from "../../lib/occasion-issuance.js";
import { assertCapability, requireCapability } from "../../lib/permissions.js";
import { walletService } from "../../lib/wallets.js";

const bulkBodySchema = z.object({
  format: z.enum(["json", "csv", "xlsx"]).default("json"),
  content: z.string().optional(),
  rows: z.array(z.record(z.unknown())).optional(),
  selectedFields: z.array(z.string().trim().min(1)).optional(),
  sourceName: z.string().max(255).optional(),
});

const offboardingScheduleSchema = z.object({
  lastWorkingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(1).max(500),
});

interface ImportRow {
  memberId?: string;
  email?: string | null;
  externalId?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  department?: string | null;
  photoUrl?: string | null;
  status?: "ACTIVE" | "INACTIVE";
  username?: string;
  password?: string;
  metadata: Record<string, unknown>;
  points: Record<string, { amount: number; expiresAt?: string }>;
  targetBalances: Record<string, { amount: number; expiresAt?: string }>;
  validationErrors: string[];
}

function normalizedKey(key: string): string {
  return key.replace(/[\s-]+/g, "_").toLowerCase();
}

function canonicalImportKey(key: string): string {
  const normalized = normalizedKey(key);
  return normalized === "external_id" ? "externalid" : normalized;
}

export function validateImportEmail(memberId?: string, email?: string | null): void {
  if (!memberId && !email) throw new LoyaltyError("BULK_EMAIL_REQUIRED", 400);
}

function pointCodeKey(code: string): string {
  return code.replace(/[-_]/g, "").toUpperCase();
}

const IMPORT_HEADER_KEYS = new Set([
  "memberid",
  "email",
  "externalid",
  "external_id",
  "phone",
  "firstname",
  "lastname",
  "department",
  "photourl",
  "status",
  "username",
    "password",
    "portal_username",
    "initial_password",
]);

const BASE_IMPORT_HEADERS = [
  "email",
  "externalId",
  "phone",
  "firstName",
  "lastName",
  "department",
  "photoUrl",
  "status",
  "username",
  "password",
] as const;

interface ImportMemberField {
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "BOOLEAN" | "DATE" | "SELECT";
  required: boolean;
  isActive: boolean;
  options: unknown;
}

function isRecognizedImportHeader(header: string, memberFields: ImportMemberField[] = []): boolean {
  const key = normalizedKey(header);
  return (
    IMPORT_HEADER_KEYS.has(key) ||
    memberFields.some((field) => key === `custom:${field.key}`) ||
    key.startsWith("custom:") ||
    /^(?:point|points|wallet|credit)_[a-z0-9_-]+$/.test(key) ||
    /^(?:balance|balances|target_balance|target)_[a-z0-9_-]+$/.test(key) ||
    /^(?:expiry|expires_at)_[a-z0-9_-]+$/.test(key)
  );
}

function isRecognizedImportHeaderRow(headers: string[], memberFields: ImportMemberField[] = []): boolean {
  return headers.filter((header) => isRecognizedImportHeader(header, memberFields)).length >= 2;
}

function defaultImportHeaders(
  columnCount: number,
  pointCodes: string[],
  selectedFields?: string[],
): string[] {
  if (selectedFields?.length) return selectedFields.slice(0, columnCount);
  const headers: string[] = [...BASE_IMPORT_HEADERS];
  const codes = pointCodes.length > 0 ? pointCodes : ["P", "R"];
  for (const code of codes) headers.push(`point_${code}`, `expiry_${code}`);
  return headers.slice(0, columnCount);
}

function selectedHeaderSet(selectedFields?: string[]): Set<string> | null {
  return selectedFields?.length ? new Set(selectedFields.map(canonicalImportKey)) : null;
}

function filterSelectedFields<T extends Record<string, unknown>>(
  row: T,
  selectedFields?: string[],
): T {
  const selected = selectedHeaderSet(selectedFields);
  if (!selected) return row;
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => selected.has(canonicalImportKey(key))),
  ) as T;
}

export function parseCsv(
  input: string,
  pointCodes: string[],
  selectedFields?: string[],
  memberFields: ImportMemberField[] = [],
): Record<string, string>[] {
  const source = input.replace(/^\uFEFF/, "");
  const parsedLines: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      row.push(field.trim());
      if (row.some((value) => value.length > 0)) parsedLines.push(row);
      row = [];
      field = "";
      if (character === "\r" && source[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }
  if (quoted) throw new LoyaltyError("BULK_CSV_UNCLOSED_QUOTE", 400);
  row.push(field.trim());
  if (row.some((value) => value.length > 0)) parsedLines.push(row);
  if (parsedLines.length === 0) return [];
  // Accept an optional title/comment line before the CSV header. Without this,
  // a preamble is mistaken for the header and the real first data row is lost.
  const headerIndex = parsedLines.findIndex((headers) => {
    return headers.length > 0 && isRecognizedImportHeaderRow(headers, memberFields);
  });
  if (headerIndex < 0) {
    const maxColumns = Math.max(...parsedLines.map((values) => values.length));
    const firstNonEmpty = parsedLines[0]?.filter((value) => value.trim().length > 0).length ?? 0;
    const titleOnly = firstNonEmpty <= 1 && maxColumns > 1;
    const dataLines = titleOnly ? parsedLines.slice(1) : parsedLines;
    const headers = defaultImportHeaders(maxColumns, pointCodes, selectedFields);
    return dataLines.map((values) =>
      filterSelectedFields(
        Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
        selectedFields,
      ),
    );
  }
  const headers = parsedLines[headerIndex] ?? [];
  return parsedLines.slice(headerIndex + 1).map((values) => {
    return filterSelectedFields(
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
      selectedFields,
    );
  });
}

function normalizeRow(row: Record<string, unknown>, memberFields: ImportMemberField[] = []): ImportRow {
  const validationErrors: string[] = [];
  const values = new Map(Object.entries(row).map(([key, value]) => [canonicalImportKey(key), value]));
  const stringValue = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const raw = values.get(normalizedKey(key));
      if (raw != null && String(raw).trim()) return String(raw).trim();
    }
    return undefined;
  };
  const memberId = stringValue("memberId", "id");
  const editableValue = (...keys: string[]): string | null | undefined => {
    const value = stringValue(...keys);
    if (value !== undefined) return value;
    return memberId && keys.some((key) => values.has(normalizedKey(key))) ? null : undefined;
  };
  const points: ImportRow["points"] = {};
  const targetBalances: ImportRow["targetBalances"] = {};
  const metadata: ImportRow["metadata"] = {};
  const fieldByKey = new Map(memberFields.filter((field) => field.isActive).map((field) => [field.key, field]));
  for (const [header, raw] of Object.entries(row)) {
    const key = canonicalImportKey(header);
    if (!key.startsWith("custom:")) continue;
    const fieldKey = key.slice("custom:".length);
    const definition = fieldByKey.get(fieldKey);
    if (!definition) {
      validationErrors.push(`Unknown custom member field ${fieldKey}`);
      continue;
    }
    const text = raw == null ? "" : String(raw).trim();
    if (!text) {
      metadata[fieldKey] = "";
      continue;
    }
    if (definition.type === "NUMBER") {
      const value = Number(text);
      if (!Number.isFinite(value)) validationErrors.push(`Invalid number in custom field ${definition.label}`);
      else metadata[fieldKey] = value;
    } else if (definition.type === "BOOLEAN") {
      const value = text.toLowerCase();
      if (["true", "1", "yes", "y"].includes(value)) metadata[fieldKey] = true;
      else if (["false", "0", "no", "n"].includes(value)) metadata[fieldKey] = false;
      else validationErrors.push(`Invalid yes/no value in custom field ${definition.label}`);
    } else if (definition.type === "DATE") {
      if (Number.isNaN(Date.parse(text))) validationErrors.push(`Invalid date in custom field ${definition.label}`);
      else metadata[fieldKey] = text;
    } else if (definition.type === "SELECT") {
      const options = Array.isArray(definition.options) ? definition.options : [];
      if (!options.includes(text)) validationErrors.push(`Invalid option in custom field ${definition.label}`);
      else metadata[fieldKey] = text;
    } else {
      metadata[fieldKey] = text;
    }
  }
  for (const [key, raw] of values) {
    const match = /^(?:point|points|wallet|credit)_([a-z0-9_-]+)$/.exec(key);
    if (!match || raw == null || String(raw).trim() === "") continue;
    const amount = Number(raw);
    if (!Number.isInteger(amount)) {
      validationErrors.push(`Invalid point amount in column ${key}`);
      continue;
    }
    if (amount === 0) continue;
    const code = (match[1] ?? "").toUpperCase();
    points[code] = {
      amount,
      expiresAt: stringValue(`expiry_${code}`, `expires_at_${code}`),
    };
  }
  // Backward-compatible headers from the former fixed P/R importer.
  for (const code of ["P", "R"]) {
    const raw = stringValue(`${code.toLowerCase()}Credit`);
    if (raw == null || points[code]) continue;
    const amount = Number(raw);
    if (!Number.isInteger(amount) || amount === 0) continue;
    points[code] = {
      amount,
      expiresAt: stringValue(`${code.toLowerCase()}ExpiresAt`),
    };
  }
  for (const [key, raw] of values) {
    const match = /^(?:balance|balances|target_balance|target)_([a-z0-9_-]+)$/.exec(key);
    if (!match || raw == null || String(raw).trim() === "") continue;
    const amount = Number(raw);
    if (!Number.isInteger(amount)) {
      validationErrors.push(`Invalid target balance in column ${key}`);
      continue;
    }
    const code = (match[1] ?? "").toUpperCase();
    targetBalances[code] = {
      amount,
      expiresAt: stringValue(`expiry_${code}`, `expires_at_${code}`),
    };
  }
  for (const code of Object.keys(targetBalances)) {
    if (points[code]) validationErrors.push(`Use either point_${code} or balance_${code}, not both`);
  }
  const rawStatus = stringValue("status")?.toUpperCase();
  if (rawStatus && rawStatus !== "ACTIVE" && rawStatus !== "INACTIVE") {
    validationErrors.push(`Invalid member status ${rawStatus}`);
  }
  const email = editableValue("email");
  return {
    memberId,
    email: email === null ? null : email?.toLowerCase(),
    externalId: editableValue("externalId", "external_id"),
    phone: editableValue("phone"),
    firstName: editableValue("firstName", "first_name"),
    lastName: editableValue("lastName", "last_name"),
    department: editableValue("department"),
    photoUrl: editableValue("photoUrl", "photo_url"),
    status: rawStatus === "ACTIVE" || rawStatus === "INACTIVE" ? rawStatus : undefined,
    username: stringValue("username", "portal_username"),
    password: stringValue("password", "initial_password"),
    metadata,
    points,
    targetBalances,
    validationErrors,
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validateImportedMemberMetadata(
  metadata: Record<string, unknown>,
  memberFields: ImportMemberField[],
): void {
  for (const field of memberFields.filter((item) => item.isActive)) {
    const value = metadata[field.key];
    const missing = value === undefined || value === null || (typeof value === "string" && value.trim() === "");
    if (field.required && missing) throw new LoyaltyError("MEMBER_FIELD_REQUIRED", 400, { field: field.key, label: field.label });
    if (missing) continue;
    const valid = field.type === "TEXT" ? typeof value === "string"
      : field.type === "NUMBER" ? typeof value === "number" && Number.isFinite(value)
        : field.type === "BOOLEAN" ? typeof value === "boolean"
          : field.type === "DATE" ? typeof value === "string" && !Number.isNaN(Date.parse(value))
            : field.type === "SELECT" && typeof value === "string" && Array.isArray(field.options) && field.options.includes(value);
    if (!valid) throw new LoyaltyError("MEMBER_FIELD_VALUE_INVALID", 400, { field: field.key, label: field.label });
  }
}

async function parseRows(
  body: z.infer<typeof bulkBodySchema>,
  pointCodes: string[],
  memberFields: ImportMemberField[],
): Promise<ImportRow[]> {
  if (body.format === "json")
    return (body.rows ?? []).map((row) => normalizeRow(filterSelectedFields(row, body.selectedFields), memberFields));
  if (!body.content) throw new LoyaltyError("BULK_CONTENT_REQUIRED", 400);
  if (body.format === "csv") return parseCsv(body.content, pointCodes, body.selectedFields, memberFields).map((row) => normalizeRow(row, memberFields));
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(body.content, "base64") as never);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];
  const worksheetRows: { rowNumber: number; values: string[] }[] = [];
  worksheet.eachRow((row, rowNumber) => {
    const candidate: string[] = [];
    row.eachCell((cell, column) => {
      candidate[column - 1] = String(cell.value ?? "").trim();
    });
    if (candidate.some((value) => value.length > 0)) worksheetRows.push({ rowNumber, values: candidate });
  });
  const headerRow = worksheetRows
    .filter((entry) => entry.rowNumber <= 20)
    .find((entry) => isRecognizedImportHeaderRow(entry.values, memberFields));
  const maxColumns = Math.max(...worksheetRows.map((entry) => entry.values.length), 0);
  const headers = headerRow
    ? headerRow.values
    : defaultImportHeaders(maxColumns, pointCodes, body.selectedFields);
  const firstNonEmpty = worksheetRows[0]?.values.filter((value) => value.trim().length > 0).length ?? 0;
  const startRow = headerRow?.rowNumber ??
    (firstNonEmpty <= 1 && maxColumns > 1 ? (worksheetRows[0]?.rowNumber ?? 0) : 0);
  const rows: Record<string, unknown>[] = [];
  for (const entry of worksheetRows) {
    if (entry.rowNumber <= startRow) continue;
    const output: Record<string, unknown> = {};
    entry.values.forEach((value, column) => {
      const header = headers[column];
      if (header) output[header] = value;
    });
    rows.push(filterSelectedFields(output, body.selectedFields));
  }
  return rows.map((row) => normalizeRow(row, memberFields));
}

export function adminCreditUsersRoutes(
  app: FastifyInstance,
  _opts: unknown,
  done: () => void,
): void {
  app.post(
    "/admin/members/bulk",
    { preHandler: [requireCapability("member.manage")] },
    async (request, reply) => {
      const body = bulkBodySchema.parse(request.body);
      const [pointTypes, memberFields] = await Promise.all([
        prisma.pointTypeDefinition.findMany({
          where: { programId: request.programId, archivedAt: null, isActive: true },
        }),
        prisma.memberFieldDefinition.findMany({
          where: { programId: request.programId },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        }),
      ]);
      const rows = await parseRows(
        body,
        pointTypes.map((pointType) => pointType.code),
        memberFields,
      );
      if (rows.length === 0) throw new LoyaltyError("BULK_ROWS_REQUIRED", 400);
      if (
        rows.some(
          (row) => Object.keys(row.points).length > 0 || Object.keys(row.targetBalances).length > 0,
        )
      ) {
        await assertCapability(request, "wallet.adjust");
      }
      if (rows.some((row) => row.username ?? row.password)) {
        await assertCapability(request, "member.credentials.manage");
      }
      const pointTypeByCode = new Map(
        pointTypes.map((pointType) => [pointCodeKey(pointType.code), pointType]),
      );
      const pointTypeForCode = (code: string) => pointTypeByCode.get(pointCodeKey(code));
      const batch = await prisma.creditBulkBatch.create({
        data: {
          programId: request.programId,
          operation: "DYNAMIC_MEMBER_IMPORT",
          createdById: request.adminId ?? request.actor.id,
          sourceName: body.sourceName,
          totalRows: rows.length,
        },
      });
      const report: Record<string, unknown>[] = [];
      let successRows = 0;

      for (const [index, row] of rows.entries()) {
        try {
          if (row.validationErrors.length > 0)
            throw new LoyaltyError(row.validationErrors.join("; "), 400);
          validateImportEmail(row.memberId, row.email);
          const normalizedUsername = row.username ? validateMemberUsername(row.username) : null;
          if (row.password && !normalizedUsername)
            throw new LoyaltyError("USERNAME_REQUIRED_FOR_PASSWORD", 400);
          if (normalizedUsername && row.password && row.password.length < 10)
            throw new LoyaltyError("PASSWORD_TOO_SHORT", 400);
          if (
            row.status === "INACTIVE" &&
            (Object.keys(row.points).length > 0 || Object.keys(row.targetBalances).length > 0)
          )
            throw new LoyaltyError("BULK_INACTIVE_MEMBER_CANNOT_RECEIVE_POINTS", 400);
          for (const [code, value] of Object.entries(row.points)) {
            const pointType = pointTypeForCode(code);
            if (!pointType) throw new LoyaltyError(`Point type ${code} does not exist`, 400);
            if (
              value.amount > 0 &&
              pointType.expiryMode === "PER_GRANT" &&
              (!value.expiresAt || Number.isNaN(new Date(value.expiresAt).getTime()))
            )
              throw new LoyaltyError(`Expiry is required for ${code}`, 400);
          }
          for (const code of Object.keys(row.targetBalances)) {
            const pointType = pointTypeForCode(code);
            if (!pointType) throw new LoyaltyError(`Point type ${code} does not exist`, 400);
          }
          const outcome = await prisma.$transaction(async (tx) => {
            const matches = row.memberId
              ? await tx.member.findMany({
                  where: { id: row.memberId, programId: request.programId },
                  take: 2,
                })
              : await tx.member.findMany({
                  where: {
                    programId: request.programId,
                    OR: [
                      ...(row.email ? [{ email: row.email }] : []),
                      ...(row.externalId ? [{ externalId: row.externalId }] : []),
                    ],
                  },
                  take: 2,
                });
            if (matches.length > 1)
              throw new LoyaltyError("BULK_IDENTIFIERS_MATCH_DIFFERENT_MEMBERS", 409);
            const existing = matches[0];
            if (row.memberId && !existing) throw new LoyaltyError("BULK_MEMBER_NOT_FOUND", 404);
            const existingMetadata = recordValue(existing?.metadata);
            const mergedMetadata = { ...existingMetadata, ...row.metadata };
            validateImportedMemberMetadata(mergedMetadata, memberFields);
            const now = new Date();
            let member = existing
              ? await tx.member.update({
                where: { id: existing.id },
                data: {
                    email: row.email !== undefined ? row.email : existing.email,
                    externalId: row.externalId !== undefined ? row.externalId : existing.externalId,
                    phone: row.phone !== undefined ? row.phone : existing.phone,
                    firstName: row.firstName !== undefined ? row.firstName : existing.firstName,
                    lastName: row.lastName !== undefined ? row.lastName : existing.lastName,
                    department: row.department !== undefined ? row.department : existing.department,
                    photoUrl: row.photoUrl !== undefined ? row.photoUrl : existing.photoUrl,
                    ...(Object.keys(row.metadata).length ? { metadata: mergedMetadata as never } : {}),
                    ...(row.status === "ACTIVE"
                      ? { status: "ACTIVE" as const, deletedAt: null, deactivatedAt: null }
                      : row.status === "INACTIVE"
                        ? { status: "INACTIVE" as const, deletedAt: now, deactivatedAt: now }
                      : {}),
                  },
                })
              : await tx.member.create({
                  data: {
                    programId: request.programId,
                    email: row.email,
                    externalId: row.externalId,
                    phone: row.phone,
                    firstName: row.firstName,
                    lastName: row.lastName,
                    department: row.department,
                    photoUrl: row.photoUrl,
                    metadata: mergedMetadata as never,
                    status: row.status ?? "ACTIVE",
                    deactivatedAt: row.status === "INACTIVE" ? now : null,
                    deletedAt: row.status === "INACTIVE" ? now : null,
                },
              });
            if (!existing) {
              await audit(
                request.programId,
                request.actor,
                "CONFIG_CHANGE",
                "member",
                member.id,
                { created: true, source: "DYNAMIC_MEMBER_IMPORT", batchId: batch.id },
                undefined,
                tx,
              );
            }

            if (normalizedUsername ?? row.password) {
              const currentCredential = await tx.memberCredential.findUnique({
                where: { memberId: member.id },
              });
              const username = normalizedUsername ?? currentCredential?.username;
              if (!username) throw new LoyaltyError("USERNAME_REQUIRED", 400);
              const passwordHash = row.password
                ? await hashMemberPassword(row.password)
                : undefined;
              await tx.memberCredential.upsert({
                where: { memberId: member.id },
                create: {
                  programId: request.programId,
                  memberId: member.id,
                  username: row.username?.trim() ?? username,
                  usernameNormalized: username,
                  passwordHash: passwordHash ?? null,
                  passwordChangedAt: passwordHash ? new Date() : null,
                },
                update: {
                  username: row.username?.trim() ?? username,
                  usernameNormalized: username,
                  ...(passwordHash ? { passwordHash, passwordChangedAt: new Date() } : {}),
                },
              });
              await audit(
                request.programId,
                request.actor,
                "CONFIG_CHANGE",
                "member_credentials",
                member.id,
                { username, passwordReset: Boolean(passwordHash), batchId: batch.id },
                undefined,
                tx,
              );
            }

            const rowReason = `Bulk member import ${batch.id}, row ${String(index + 2)}`;
            const transactions = [];
            if (row.status === "INACTIVE" && existing) {
              const cleared = await walletService.clearMemberWithTransaction(
                tx,
                request.programId,
                member.id,
                request.actor,
                rowReason,
                `point-bulk-clear:${batch.id}:${String(index)}`,
              );
              transactions.push(...cleared);
              await audit(
                request.programId,
                request.actor,
                "CREDIT_CLEARANCE",
                "member",
                member.id,
                { transactionIds: cleared.map((transaction) => transaction.id) },
                rowReason,
                tx,
              );
            } else {
              for (const [code, value] of Object.entries(row.points)) {
                const pointType = pointTypeForCode(code);
                if (!pointType) continue;
                const transaction = await walletService.adjustWithTransaction(
                  tx,
                  request.programId,
                  member.id,
                  { pointTypeId: pointType.id },
                  value.amount,
                  rowReason,
                  request.actor,
                  `point-bulk:${batch.id}:${String(index)}:${pointType.id}`,
                  value.expiresAt ? new Date(value.expiresAt) : undefined,
                );
                transactions.push(transaction);
                await audit(
                  request.programId,
                  request.actor,
                  "CREDIT_ADJUSTMENT",
                  "point_wallet",
                  transaction.id,
                  {
                    memberId: member.id,
                    pointTypeId: pointType.id,
                    amount: value.amount,
                    beforeBalance: transaction.balanceBefore,
                    afterBalance: transaction.balanceAfter,
                    batchId: batch.id,
                    row: index + 2,
                  },
                  rowReason,
                  tx,
                );
              }
              const targetPointTypeIds = Object.entries(row.targetBalances)
                .map(([code]) => pointTypeForCode(code)?.id)
                .filter((id): id is string => Boolean(id));
              const currentWallets =
                targetPointTypeIds.length > 0
                  ? await tx.customPointWallet.findMany({
                      where: {
                        memberId: member.id,
                        programId: request.programId,
                        pointTypeId: { in: targetPointTypeIds },
                      },
                    })
                  : [];
              const currentBalanceByType = new Map(
                currentWallets.map((wallet) => [wallet.pointTypeId, wallet.balance]),
              );
              for (const [code, value] of Object.entries(row.targetBalances)) {
                const pointType = pointTypeForCode(code);
                if (!pointType) continue;
                const currentBalance = currentBalanceByType.get(pointType.id) ?? 0;
                const delta = value.amount - currentBalance;
                if (delta === 0) continue;
                if (
                  delta > 0 &&
                  pointType.expiryMode === "PER_GRANT" &&
                  (!value.expiresAt || Number.isNaN(new Date(value.expiresAt).getTime()))
                )
                  throw new LoyaltyError(`Expiry is required for ${code}`, 400);
                const transaction = await walletService.adjustWithTransaction(
                  tx,
                  request.programId,
                  member.id,
                  { pointTypeId: pointType.id },
                  delta,
                  rowReason,
                  request.actor,
                  `point-bulk-target:${batch.id}:${String(index)}:${pointType.id}`,
                  delta > 0 && value.expiresAt ? new Date(value.expiresAt) : undefined,
                );
                transactions.push(transaction);
                await audit(
                  request.programId,
                  request.actor,
                  "CREDIT_ADJUSTMENT",
                  "point_wallet",
                  transaction.id,
                  {
                    memberId: member.id,
                    pointTypeId: pointType.id,
                    amount: delta,
                    targetBalance: value.amount,
                    beforeBalance: transaction.balanceBefore,
                    afterBalance: transaction.balanceAfter,
                    batchId: batch.id,
                    row: index + 2,
                  },
                  rowReason,
                  tx,
                );
              }
            }
            member = await tx.member.findUniqueOrThrow({ where: { id: member.id } });
            return { member, transactions, created: !existing };
          });
          successRows += 1;
          if (outcome.created) {
            void issueOnboardingForMember(request.programId, outcome.member.id).catch((error: unknown) => {
              request.log.error({ err: error, memberId: outcome.member.id }, "Failed to issue onboarding campaigns");
            });
          }
          report.push({
            row: index + 2,
            status: "success",
            memberId: outcome.member.id,
            email: outcome.member.email,
            pointTypes: [...new Set([...Object.keys(row.points), ...Object.keys(row.targetBalances)])],
            transactionIds: outcome.transactions.map((transaction) => transaction.id),
          });
        } catch (error) {
          report.push({
            row: index + 2,
            status: "failed",
            error: error instanceof Error ? error.message : "Import failed",
          });
        }
      }

      const result = await prisma.creditBulkBatch.update({
        where: { id: batch.id },
        data: {
          status:
            successRows === rows.length ? "COMPLETED" : successRows === 0 ? "FAILED" : "PARTIAL",
          successRows,
          failedRows: rows.length - successRows,
          report: report as never,
          completedAt: new Date(),
        },
      });
      await audit(request.programId, request.actor, "CREDIT_BULK", "credit_bulk_batch", batch.id, {
        operation: result.operation,
        totalRows: result.totalRows,
        successRows,
        failedRows: rows.length - successRows,
      });
      return reply.status(201).send({ data: result });
    },
  );

  app.get(
    "/admin/members/bulk/:id",
    { preHandler: [requireCapability("member.view")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const batch = await prisma.creditBulkBatch.findFirst({
        where: { id, programId: request.programId },
      });
      if (!batch) throw new LoyaltyError("NOT_FOUND", 404);
      return reply.send({ data: batch });
    },
  );

  app.delete(
    "/admin/members/:id",
    { preHandler: [requireCapability("member.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const requestKey = request.headers["idempotency-key"];
      if (typeof requestKey !== "string" || requestKey.length < 8) {
        throw new LoyaltyError("MISSING_IDEMPOTENCY_KEY", 400);
      }

      const member = await prisma.member.findFirst({
        where: { id, programId: request.programId },
        select: { id: true, email: true, deletedAt: true },
      });
      if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
      if (member.deletedAt) throw new LoyaltyError("MEMBER_ALREADY_DELETED", 409);

      const reason = "Deleted by administrator";
      await prisma.$transaction(async (tx) => {
        const cleared = await walletService.clearMemberWithTransaction(
          tx,
          request.programId,
          id,
          request.actor,
          reason,
          requestKey,
        );
        await audit(
          request.programId,
          request.actor,
          "CONFIG_CHANGE",
          "member",
          id,
          {
            deleted: true,
            email: member.email,
            clearedTransactions: cleared.map((transaction) => transaction.id),
          },
          reason,
          tx,
        );
      });

      return reply.status(204).send();
    },
  );


  app.post(
    "/admin/members/:id/offboarding-schedule",
    { preHandler: [requireCapability("member.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = offboardingScheduleSchema.parse(request.body);
      const lastWorkingDay = new Date(`${body.lastWorkingDay}T00:00:00.000Z`);
      if (
        Number.isNaN(lastWorkingDay.getTime()) ||
        lastWorkingDay.toISOString().slice(0, 10) !== body.lastWorkingDay
      ) throw new LoyaltyError("OFFBOARDING_DATE_INVALID", 400);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      if (lastWorkingDay < today) throw new LoyaltyError("OFFBOARDING_DATE_IN_PAST", 400);
      const member = await prisma.member.findFirst({ where: { id, programId: request.programId } });
      if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
      if (member.status !== "ACTIVE" || member.deletedAt) throw new LoyaltyError("MEMBER_NOT_ACTIVE", 409);
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.member.update({
          where: { id },
          data: { lastWorkingDay, offboardingReason: body.reason },
        });
        await audit(
          request.programId, request.actor, "CONFIG_CHANGE", "member", id,
          { offboardingScheduled: true, lastWorkingDay: body.lastWorkingDay }, body.reason, tx,
        );
        return result;
      });
      return reply.send({ data: updated });
    },
  );

  app.delete(
    "/admin/members/:id/offboarding-schedule",
    { preHandler: [requireCapability("member.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z.object({ reason: z.string().trim().min(1).max(500) }).parse(request.body);
      const member = await prisma.member.findFirst({ where: { id, programId: request.programId } });
      if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
      if (member.status !== "ACTIVE" || member.deletedAt) throw new LoyaltyError("OFFBOARDING_NOT_SCHEDULED", 409);
      if (!member.lastWorkingDay) throw new LoyaltyError("OFFBOARDING_NOT_SCHEDULED", 409);
      const scheduledDate = member.lastWorkingDay.toISOString().slice(0, 10);
      const updated = await prisma.$transaction(async (tx) => {
        const changed = await tx.member.updateMany({
          where: { id, programId: request.programId, status: "ACTIVE", deletedAt: null, lastWorkingDay: member.lastWorkingDay },
          data: { lastWorkingDay: null, offboardingReason: null },
        });
        if (changed.count !== 1) throw new LoyaltyError("OFFBOARDING_NOT_SCHEDULED", 409);
        const result = await tx.member.findUniqueOrThrow({ where: { id } });
        await audit(
          request.programId, request.actor, "CONFIG_CHANGE", "member", id,
          { offboardingScheduled: false, previousLastWorkingDay: scheduledDate }, body.reason, tx,
        );
        return result;
      });
      return reply.send({ data: updated });
    },
  );


  app.post(
    "/admin/members/:id/status",
    { preHandler: [requireCapability("member.manage")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z
        .object({
          status: z.enum(["ACTIVE", "INACTIVE"]),
          reason: z.string().trim().min(1).max(500),
        })
        .parse(request.body);
      const member = await prisma.member.findFirst({
        where: { id, programId: request.programId },
      });
      if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
      if (body.status === "INACTIVE") {
        const requestKey = request.headers["idempotency-key"];
        if (typeof requestKey !== "string" || requestKey.length < 8)
          throw new LoyaltyError("MISSING_IDEMPOTENCY_KEY", 400);
        await prisma.$transaction(async (tx) => {
          const cleared = await walletService.clearMemberWithTransaction(
            tx,
            request.programId,
            id,
            request.actor,
            body.reason,
            requestKey,
          );
          await audit(
            request.programId,
            request.actor,
            "CREDIT_CLEARANCE",
            "member",
            id,
            {
              clearedTransactions: cleared.map((item) => item.id),
              status: body.status,
            },
            body.reason,
            tx,
          );
        });
      } else {
        await prisma.$transaction(async (tx) => {
          await tx.member.update({
            where: { id },
            data: { status: "ACTIVE", deactivatedAt: null, deletedAt: null, lastWorkingDay: null, offboardingReason: null },
          });
          await audit(
            request.programId,
            request.actor,
            "CREDIT_CLEARANCE",
            "member",
            id,
            { status: body.status },
            body.reason,
            tx,
          );
        });
      }
      return reply.send({ data: await prisma.member.findUnique({ where: { id } }) });
    },
  );

  done();
}
