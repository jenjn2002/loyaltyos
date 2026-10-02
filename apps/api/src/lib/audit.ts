import { createHash } from "node:crypto";

import type { AuditAction, AuditActorType, Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../db.js";

export interface AuditActor {
  type: AuditActorType;
  id: string;
}

type AuditDbClient = PrismaClient | Prisma.TransactionClient;

function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (input instanceof Date) return input.toISOString();
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input).sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, normalize(item)]),
      );
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

function hashAuditRecord(input: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

async function writeAudit(
  client: AuditDbClient,
  input: {
    programId: string;
    actor: AuditActor;
    action: AuditAction;
    entityType: string;
    entityId: string | null;
    diff: Record<string, unknown>;
    reason?: string;
  },
): Promise<void> {
  const lockKey = `audit:${input.programId}`;
  await client.$queryRaw<{ locked: string }>`
    SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS locked
  `;
  const previous = await client.auditLog.findFirst({
    where: { programId: input.programId, hashVersion: 2, recordHash: { not: null } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { recordHash: true, createdAt: true },
  });
  const now = new Date();
  const createdAt =
    previous && previous.createdAt.getTime() >= now.getTime()
      ? new Date(previous.createdAt.getTime() + 1)
      : now;
  const previousHash = previous?.recordHash ?? null;
  const record = {
    programId: input.programId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    adminUserId: input.actor.type === "ADMIN_USER" ? input.actor.id : null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    diff: input.diff,
    reason: input.reason ?? null,
    ipAddress: null,
    previousHash,
    hashVersion: 2,
    createdAt,
  };
  await client.auditLog.create({
    data: {
      ...record,
      diff: input.diff as never,
      recordHash: hashAuditRecord(record),
    },
  });
}

export async function audit(
  programId: string,
  actor: AuditActor,
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  diff: Record<string, unknown> = {},
  reason?: string,
  client: AuditDbClient = prisma,
): Promise<void> {
  const input = { programId, actor, action, entityType, entityId, diff, reason };
  if (client === prisma) {
    await prisma.$transaction((tx) => writeAudit(tx, input));
    return;
  }
  await writeAudit(client, input);
}

export async function verifyAuditLogIntegrity(programId: string): Promise<{
  checked: number;
  legacyUnverifiable: number;
  invalidIds: string[];
}> {
  const rows = await prisma.auditLog.findMany({
    where: { programId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  let previousHash: string | null = null;
  let checked = 0;
  let legacyUnverifiable = 0;
  const invalidIds: string[] = [];
  for (const row of rows) {
    if (!row.recordHash || row.hashVersion !== 2) {
      legacyUnverifiable += 1;
      continue;
    }
    checked += 1;
    const { id: _id, recordHash: _recordHash, ...record } = row;
    const expected = hashAuditRecord(record as unknown as Record<string, unknown>);
    if (row.previousHash !== previousHash || row.recordHash !== expected) {
      invalidIds.push(row.id);
    }
    previousHash = row.recordHash;
  }
  return { checked, legacyUnverifiable, invalidIds };
}
