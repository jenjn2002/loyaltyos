import type { AuditActorType } from "@prisma/client";

import { prisma } from "../db.js";

export interface CreatedBy {
  id: string;
  name: string;
  email: string | null;
}

function actorLabel(type: AuditActorType): string {
  if (type === "SYSTEM") return "System";
  if (type === "API_KEY") return "API key";
  if (type === "MEMBER") return "Member";
  return "Admin user";
}

/**
 * Resolve the first audit actor for each entity. Creation audits are ordered
 * first, so later edits do not replace the original creator. Legacy records
 * without an audit entry intentionally return null.
 */
export async function createdByForEntities(
  programId: string,
  entityType: string,
  entityIds: string[],
): Promise<Map<string, CreatedBy>> {
  const ids = [...new Set(entityIds.filter(Boolean))];
  if (!ids.length) return new Map();

  const logs = await prisma.auditLog.findMany({
    where: { programId, entityType, entityId: { in: ids } },
    select: {
      entityId: true,
      actorId: true,
      actorType: true,
      adminUser: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const creators = new Map<string, CreatedBy>();
  for (const log of logs) {
    if (!log.entityId || creators.has(log.entityId)) continue;
    creators.set(
      log.entityId,
      log.adminUser
        ? { id: log.adminUser.id, name: log.adminUser.name, email: log.adminUser.email }
        : { id: log.actorId, name: actorLabel(log.actorType), email: null },
    );
  }
  return creators;
}

