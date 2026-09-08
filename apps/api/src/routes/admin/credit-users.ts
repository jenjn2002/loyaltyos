import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { creditService, type CreditKind } from "../../lib/credits.js";
import { LoyaltyError } from "../../lib/errors.js";
import { requireAdmin } from "../../plugins/require-admin.js";

const bulkBodySchema = z.object({
  format: z.enum(["json", "csv", "xlsx"]).default("json"),
  content: z.string().optional(),
  rows: z.array(z.record(z.unknown())).optional(),
  sourceName: z.string().max(255).optional(),
});

type ImportRow = {
  email?: string;
  externalId?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  department?: string;
  photoUrl?: string;
  pCredit?: number;
  rCredit?: number;
  pExpiresAt?: string;
};

function parseCsv(input: string): Record<string, string>[] {
  const lines = input.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index++;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  };
  const headers = parseLine(lines[0]!).map((value) => value.trim());
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function normalizeRow(row: Record<string, unknown>): ImportRow {
  const value = (key: string): string | undefined => {
    const raw = row[key] ?? row[key.toLowerCase()] ?? row[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
    return raw == null || String(raw).trim() === "" ? undefined : String(raw).trim();
  };
  const number = (key: string): number | undefined => {
    const raw = value(key);
    if (raw == null) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    email: value("email")?.toLowerCase(),
    externalId: value("externalId"),
    phone: value("phone"),
    firstName: value("firstName"),
    lastName: value("lastName"),
    department: value("department"),
    photoUrl: value("photoUrl"),
    pCredit: number("pCredit"),
    rCredit: number("rCredit"),
    pExpiresAt: value("pExpiresAt"),
  };
}

async function parseRows(body: z.infer<typeof bulkBodySchema>): Promise<ImportRow[]> {
  if (body.format === "json") {
    return (body.rows ?? []).map(normalizeRow);
  }
  if (!body.content) throw new LoyaltyError("BULK_CONTENT_REQUIRED", 400);
  if (body.format === "csv") return parseCsv(body.content).map(normalizeRow);

  let ExcelJS: typeof import("exceljs");
  try {
    ExcelJS = await import("exceljs");
  } catch {
    throw new LoyaltyError("XLSX_IMPORT_NOT_AVAILABLE", 503);
  }
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
    const result: Record<string, unknown> = {};
    row.eachCell((cell, column) => {
      const header = headers[column - 1];
      if (header) result[header] = cell.value;
    });
    rows.push(result);
  });
  return rows.map(normalizeRow);
}

function positiveAmount(value: number | undefined): number {
  return value != null && Number.isInteger(value) && value > 0 ? value : 0;
}

export function adminCreditUsersRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.post("/admin/members/bulk", { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = bulkBodySchema.parse(request.body);
    const rows = await parseRows(body);
    if (rows.length === 0) throw new LoyaltyError("BULK_ROWS_REQUIRED", 400);

    const batch = await prisma.creditBulkBatch.create({
      data: {
        programId: request.programId,
        operation: "MEMBER_IMPORT_WITH_CREDIT_SEED",
        createdById: request.adminId ?? request.actor.id,
        sourceName: body.sourceName,
        totalRows: rows.length,
      },
    });
    const report: Array<Record<string, unknown>> = [];
    let successRows = 0;

    for (const [index, row] of rows.entries()) {
      try {
        if (!row.email && !row.externalId) throw new LoyaltyError("BULK_EMAIL_OR_EXTERNAL_ID_REQUIRED", 400);
        const existing = await prisma.member.findFirst({
          where: {
            programId: request.programId,
            OR: [
              ...(row.email ? [{ email: row.email }] : []),
              ...(row.externalId ? [{ externalId: row.externalId }] : []),
            ],
          },
        });
        const member = existing
          ? await prisma.member.update({
              where: { id: existing.id },
              data: {
                email: row.email ?? existing.email,
                externalId: row.externalId ?? existing.externalId,
                phone: row.phone ?? existing.phone,
                firstName: row.firstName ?? existing.firstName,
                lastName: row.lastName ?? existing.lastName,
                department: row.department ?? existing.department,
                photoUrl: row.photoUrl ?? existing.photoUrl,
                status: "ACTIVE",
                deletedAt: null,
                deactivatedAt: null,
              },
            })
          : await prisma.member.create({
              data: {
                programId: request.programId,
                email: row.email,
                externalId: row.externalId,
                phone: row.phone,
                firstName: row.firstName,
                lastName: row.lastName,
                department: row.department,
                photoUrl: row.photoUrl,
              },
            });

        const seed = async (creditType: CreditKind, amount: number, expiresAt?: string) => {
          if (amount <= 0) return null;
          return creditService.adminAdjust(request.programId, request.adminId ?? "system", {
            memberId: member.id,
            creditType,
            amount,
            reason: "Bulk onboarding import",
            expiresAt: creditType === "P" ? new Date(expiresAt ?? "") : undefined,
            idempotencyKey: `credit-bulk:${batch.id}:${String(index)}:${creditType}`,
          });
        };
        const pAmount = positiveAmount(row.pCredit);
        const rAmount = positiveAmount(row.rCredit);
        if (pAmount > 0 && (!row.pExpiresAt || Number.isNaN(new Date(row.pExpiresAt).getTime()))) {
          throw new LoyaltyError("P_CREDIT_EXPIRY_REQUIRED", 400);
        }
        await seed("P", pAmount, row.pExpiresAt);
        await seed("R", rAmount);
        successRows++;
        report.push({ row: index + 2, status: "success", memberId: member.id, email: member.email });
      } catch (error) {
        report.push({ row: index + 2, status: "failed", error: error instanceof Error ? error.message : "Import failed" });
      }
    }

    const result = await prisma.creditBulkBatch.update({
      where: { id: batch.id },
      data: {
        status: successRows === rows.length ? "COMPLETED" : successRows === 0 ? "FAILED" : "PARTIAL",
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
  });

  app.get("/admin/members/bulk/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const batch = await prisma.creditBulkBatch.findFirst({ where: { id, programId: request.programId } });
    if (!batch) throw new LoyaltyError("NOT_FOUND", 404);
    return reply.send({ data: batch });
  });

  app.post("/admin/members/:id/status", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]), reason: z.string().trim().min(1) }).parse(request.body);
    const member = await prisma.member.findFirst({ where: { id, programId: request.programId } });
    if (!member) throw new LoyaltyError("MEMBER_NOT_FOUND", 404);
    if (body.status === "INACTIVE") {
      const cleared = await creditService.clearMemberBalances(request.programId, id, request.adminId ?? "system", body.reason);
      await audit(request.programId, request.actor, "CREDIT_CLEARANCE", "member", id, { clearedTransactions: cleared.map((item) => item.id), status: body.status }, body.reason);
    } else {
      await creditService.reactivateMember(request.programId, id);
      await audit(request.programId, request.actor, "CREDIT_CLEARANCE", "member", id, { status: body.status }, body.reason);
    }
    return reply.send({ data: await prisma.member.findUnique({ where: { id } }) });
  });

  done();
}
