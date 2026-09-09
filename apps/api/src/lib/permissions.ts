import type { AdminRole } from "@prisma/client";
import type { FastifyRequest, preHandlerAsyncHookHandler } from "fastify";

import { prisma } from "../db.js";
import { LoyaltyError } from "./errors.js";

export const ADMIN_CAPABILITIES = [
  "dashboard.view",
  "member.view",
  "member.manage",
  "wallet.view",
  "wallet.adjust",
  "point_type.view",
  "point_type.manage",
  "bank.view",
  "bank.manage",
  "exchange.view",
  "exchange.manage",
  "reward.view",
  "reward.manage",
  "campaign.view",
  "campaign.manage",
  "notification.view",
  "notification.manage",
  "audit.view",
  "permission.manage",
] as const;

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: "Owner",
  OPERATOR: "Operator",
  ANALYST: "Auditor",
};

const readCapabilities = new Set<AdminCapability>(
  ADMIN_CAPABILITIES.filter((capability) => capability.endsWith(".view")),
);

export function defaultCapability(role: AdminRole, capability: AdminCapability): boolean {
  if (role === "SUPER_ADMIN") return true;
  if (role === "ANALYST") return readCapabilities.has(capability);
  return capability !== "permission.manage" && capability !== "point_type.manage";
}

export async function capabilitiesFor(
  programId: string,
  role: AdminRole,
): Promise<Record<AdminCapability, boolean>> {
  if (role === "SUPER_ADMIN") {
    return Object.fromEntries(ADMIN_CAPABILITIES.map((capability) => [capability, true])) as Record<
      AdminCapability,
      boolean
    >;
  }
  const overrides = await prisma.adminRolePermission.findMany({
    where: { programId, role },
  });
  const overrideByCapability = new Map(
    overrides.map((override) => [override.capability, override.allowed]),
  );
  return Object.fromEntries(
    ADMIN_CAPABILITIES.map((capability) => [
      capability,
      overrideByCapability.get(capability) ?? defaultCapability(role, capability),
    ]),
  ) as Record<AdminCapability, boolean>;
}

export async function assertCapability(
  request: FastifyRequest,
  capability: AdminCapability,
): Promise<void> {
  if (request.apiKeyScope === "SERVER" && !request.adminId) return;
  if (!request.adminId) throw new LoyaltyError("FORBIDDEN", 403);
  const admin = await prisma.adminUser.findFirst({
    where: {
      id: request.adminId,
      programId: request.programId,
      isActive: true,
    },
    select: { role: true },
  });
  if (!admin) throw new LoyaltyError("FORBIDDEN", 403);
  const override = await prisma.adminRolePermission.findUnique({
    where: {
      programId_role_capability: {
        programId: request.programId,
        role: admin.role,
        capability,
      },
    },
    select: { allowed: true },
  });
  if (!(override?.allowed ?? defaultCapability(admin.role, capability)))
    throw new LoyaltyError("FORBIDDEN", 403);
}

export function requireCapability(capability: AdminCapability): preHandlerAsyncHookHandler {
  return async (request) => {
    await assertCapability(request, capability);
  };
}

export function capabilityForAdminRequest(method: string, url: string): AdminCapability | null {
  const write = method !== "GET" && method !== "HEAD";
  if (url.startsWith("/api/v1/admin/permissions")) return "permission.manage";
  if (url.startsWith("/api/v1/admin/point-types"))
    return write ? "point_type.manage" : "point_type.view";
  if (url.startsWith("/api/v1/admin/members")) return write ? "member.manage" : "member.view";
  if (url.includes("/credits/audit")) return "audit.view";
  if (url.includes("/credits/bank")) return write ? "bank.manage" : "bank.view";
  if (url.includes("/credits/exchange")) return write ? "exchange.manage" : "exchange.view";
  if (url.startsWith("/api/v1/admin/credits")) return write ? "wallet.adjust" : "wallet.view";
  if (url.startsWith("/api/v1/admin/rewards") || url.startsWith("/api/v1/admin/giftcards"))
    return write ? "reward.manage" : "reward.view";
  if (
    url.startsWith("/api/v1/admin/campaigns") ||
    url.startsWith("/api/v1/admin/segments") ||
    url.startsWith("/api/v1/admin/coupons") ||
    url.startsWith("/api/v1/admin/badges") ||
    url.startsWith("/api/v1/admin/tiers") ||
    url.startsWith("/api/v1/admin/coalition")
  )
    return write ? "campaign.manage" : "campaign.view";
  if (url.startsWith("/api/v1/admin/notification") || url.startsWith("/api/v1/admin/webhooks"))
    return write ? "notification.manage" : "notification.view";
  if (url.startsWith("/api/v1/admin/programs"))
    return write ? "point_type.manage" : "point_type.view";
  return null;
}
