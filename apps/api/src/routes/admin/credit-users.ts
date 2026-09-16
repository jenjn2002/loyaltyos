import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { LoyaltyError } from "../../lib/errors.js";
import { hashMemberPassword, validateMemberUsername } from "../../lib/member-auth.js";
import { assertCapability, requireCapability } from "../../lib/permissions.js";
import { walletService } from "../../lib/wallets.js";

const bulkBodySchema = z.object({
  format: z.enum(["json", "csv", "xlsx"]).default("json"),
  content: z.string().optional(),
  rows: z.array(z.record(z.unknown())).optional(),
  sourceName: z.string().max(255).optional(),
});

interface ImportRow {
  email?: string;
  externalId?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  department?: string;
  photoUrl?: string;
  status?: "ACTIVE" | "INACTIVE";
  username?: string;
  password?: string;
  points: Record<string, { amount: number; expiresAt?: string }>;
  validationErrors: string[];
}

function parseCsv(input: string): Record<string, string>[] {
  const lines = input
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index] ?? "";
      if (character === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (character === '"') quoted = !quoted;
      else if (character === "," && !quoted) {
        cells.push(current.trim());
        current = "";
      } else current += character;
    }
    cells.push(current.trim());
    return cells;
  };
  const headers = parseLine(lines[0] ?? "");
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function normalizedKey(key: string): string {
  return key.replace(/[\s-]+/g, "_").toLowerCase();
}

function normalizeRow(row: Record<string, unknown>): ImportRow {
  const validationErrors: string[] = [];
  const values = new Map(Object.entries(row).map(([key, value]) => [normalizedKey(key), value]));
  const stringValue = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const raw = values.get(normalizedKey(key));
      if (raw != null && String(raw).trim()) return String(raw).trim();
    }
    return undefined;
  };
  const points: ImportRow["points"] = {};
  for (const [key, raw] of values) {
    const match = /^(?:point|points|wallet|credit)_([a-z0-9_-]+)$/.exec(key);
    if (!match || raw == null || String(raw).trim() === "") continue;
    const amount = Number(raw);
    if (!Number.isInteger(amount) || amount === 0) {
      validationErrors.push(`Invalid point amount in column ${key}`);
      continue;
    }
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
  const rawStatus = stringValue("status")?.toUpperCase();
  if (rawStatus && rawStatus !== "ACTIVE" && rawStatus !== "INACTIVE") {
    validationErrors.push(`Invalid member status ${rawStatus}`);
  }
  return {
    email: stringValue("email")?.toLowerCase(),
    externalId: stringValue("externalId", "external_id"),
    phone: stringValue("phone"),
    firstName: stringValue("firstName", "first_name"),
    lastName: stringValue("lastName", "last_name"),
    department: stringValue("department"),
    photoUrl: stringValue("photoUrl", "photo_url"),
    status: rawStatus === "ACTIVE" || rawStatus === "INACTIVE" ? rawStatus : undefined,
    username: stringValue("username", "portal_username"),
    password: stringValue("password", "initial_password"),
    points,
    validationErrors,
  };
}

async function parseRows(body: z.infer<typeof bulkBodySchema>): Promise<ImportRow[]> {
  if (body.format === "json") return (body.rows ?? []).map(normalizeRow);
  if (!body.content) throw new LoyaltyError("BULK_CONTENT_REQUIRED", 400);
  if (body.format === "csv") return parseCsv(body.content).map(normalizeRow);
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(body.content, "base64") as never);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];
  const headers: string[] = [];
  worksheet.getRow(1).eachCell((cell, column) => {
    headers[column - 1] = String(cell.value ?? "").trim();
  });
  const rows: Record<string, unknown>[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const output: Record<string, unknown> = {};
    row.eachCell((cell, column) => {
      const header = headers[column - 1];
      if (header) output[header] = cell.value;
    });
    rows.push(output);
  });
  return rows.map(normalizeRow);
}

export function adminCreditUsersRoutes(
  app: FastifyInstance,
  _opts: unknown,
  done: () => void,
): void {
  app.post(
    "/admin/members/bulk",
    { preHandler: [requireCapability("member.manage"), requireCapability("wallet.adjust")] },
    async (request, reply) => {
      const body = bulkBodySchema.parse(request.body);
      const rows = await parseRows(body);
      if (rows.length === 0) throw new LoyaltyError("BULK_ROWS_REQUIRED", 400);
      if (rows.some((row) => row.username ?? row.password)) {
        await assertCapability(request, "member.credentials.manage");
      }
      const pointTypes = await prisma.pointTypeDefinition.findMany({
        where: { programId: request.programId, archivedAt: null, isActive: true },
      });
      const pointTypeByCode = new Map(pointTypes.map((pointType) => [pointType.code, pointType]));
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
          if (!row.email && !row.externalId)
            throw new LoyaltyError("BULK_EMAIL_OR_EXTERNAL_ID_REQUIRED", 400);
          const normalizedUsername = row.username ? validateMemberUsername(row.username) : null;
          if (row.password && !normalizedUsername)
            throw new LoyaltyError("USERNAME_REQUIRED_FOR_PASSWORD", 400);
          if (normalizedUsername && row.password && row.password.length < 10)
            throw new LoyaltyError("PASSWORD_TOO_SHORT", 400);
          if (row.status === "INACTIVE" && Object.keys(row.points).length > 0)
            throw new LoyaltyError("BULK_INACTIVE_MEMBER_CANNOT_RECEIVE_POINTS", 400);
          for (const [code, value] of Object.entries(row.points)) {
            const pointType = pointTypeByCode.get(code);
            if (!pointType) throw new LoyaltyError(`Point type ${code} does not exist`, 400);
            if (
              value.amount > 0 &&
              pointType.expiryMode === "PER_GRANT" &&
              (!value.expiresAt || Number.isNaN(new Date(value.expiresAt).getTime()))
            )
              throw new LoyaltyError(`Expiry is required for ${code}`, 400);
          }
          const outcome = await prisma.$transaction(async (tx) => {
            const matches = await tx.member.findMany({
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
            const now = new Date();
            let member = existing
              ? await tx.member.update({
                  where: { id: existing.id },
                  data: {
                    email: row.email ?? existing.email,
                    externalId: row.externalId ?? existing.externalId,
                    phone: row.phone ?? existing.phone,
                    firstName: row.firstName ?? existing.firstName,
                    lastName: row.lastName ?? existing.lastName,
                    department: row.department ?? existing.department,
                    photoUrl: row.photoUrl ?? existing.photoUrl,
                    ...(row.status === "ACTIVE"
                      ? { status: "ACTIVE" as const, deletedAt: null, deactivatedAt: null }
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
                    status: row.status ?? "ACTIVE",
                    deactivatedAt: row.status === "INACTIVE" ? now : null,
                    deletedAt: row.status === "INACTIVE" ? now : null,
                  },
                });

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
                const pointType = pointTypeByCode.get(code);
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
            }
            member = await tx.member.findUniqueOrThrow({ where: { id: member.id } });
            return { member, transactions };
          });
          successRows += 1;
          report.push({
            row: index + 2,
            status: "success",
            memberId: outcome.member.id,
            email: outcome.member.email,
            pointTypes: Object.keys(row.points),
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
            data: { status: "ACTIVE", deactivatedAt: null, deletedAt: null },
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
