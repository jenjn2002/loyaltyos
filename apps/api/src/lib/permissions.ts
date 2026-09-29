import type { FastifyRequest, preHandlerAsyncHookHandler } from "fastify";

import { prisma } from "../db.js";
import { LoyaltyError } from "./errors.js";

export const ADMIN_CAPABILITIES = [
  "dashboard.view",
  "member.view",
  "member.manage",
  "member.credentials.manage",
  "wallet.view",
  "wallet.adjust",
  "point_type.view",
  "point_type.manage",
  "bank.view",
  "bank.manage",
  "exchange.view",
  "exchange.manage",
  "exchange.approve",
  "exchange.complete",
  "workflow.view",
  "workflow.manage",
  "approval.inbox",
  "approval.view",
  "approval.decide",
  "reward.view",
  "reward.manage",
  "campaign.view",
  "campaign.manage",
  "campaign.execute",
  "project.view",
  "project.manage",
  "project.finance.view",
  "segment.view",
  "segment.manage",
  "tier.view",
  "tier.manage",
  "badge.view",
  "badge.manage",
  "coupon.view",
  "coupon.manage",
  "coalition.view",
  "coalition.manage",
  "giftcard.view",
  "giftcard.manage",
  "event.view",
  "event.manage",
  "issuance.view",
  "issuance.manage",
  "recognition.view",
  "recognition.manage",
  "notification.view",
  "notification.manage",
  "audit.view",
  "permission.manage",
  "settings.view",
  "settings.manage",
] as const;

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

export const ADMIN_ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Owner",
  OPERATOR: "Operator",
  ANALYST: "Auditor",
};

const readCapabilities = new Set<AdminCapability>(
  ADMIN_CAPABILITIES.filter(
    (capability) => capability.endsWith(".view") || capability.endsWith(".inbox"),
  ),
);
const ownerOnlyByDefault = new Set<AdminCapability>([
  "permission.manage",
  "point_type.manage",
  "exchange.approve",
  "exchange.complete",
  "workflow.manage",
  "approval.decide",
  "settings.manage",
  "member.credentials.manage",
]);

export function defaultCapability(role: string, capability: AdminCapability): boolean {
  if (role === "SUPER_ADMIN") return true;
  // Project finance is deliberately excluded from the generic read capability
  // default, which would otherwise grant it to ANALYST roles because it ends
  // in `.view`.
  if (capability === "project.finance.view") return false;
  if (role === "ANALYST") return readCapabilities.has(capability);
  if (role === "OPERATOR") return !ownerOnlyByDefault.has(capability);
  return false;
}

export async function capabilitiesFor(
  programId: string,
  role: string,
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
  url = url.split("?")[0] ?? url;
  const write = method !== "GET" && method !== "HEAD";
  // Dataset-level read permissions are enforced by the export route itself.
  if (url.startsWith("/api/v1/admin/workflows")) return write ? "workflow.manage" : "workflow.view";
  if (
    url.startsWith("/api/v1/admin/workflow-approvers") ||
    url.startsWith("/api/v1/admin/workflow-scope-options")
  )
    return write ? "workflow.manage" : "workflow.view";
  if (url.startsWith("/api/v1/admin/approvals")) {
    if (url.endsWith("/approve") || url.endsWith("/reject")) return "approval.decide";
    return url.includes("/inbox") || url.endsWith("/read-state") ? "approval.inbox" : "approval.view";
  }
  if (
    url.startsWith("/api/v1/admin/permissions") ||
    url.startsWith("/api/v1/admin/roles") ||
    url.startsWith("/api/v1/admin/users")
  )
    return "permission.manage";
  if (url.startsWith("/api/v1/admin/settings")) return write ? "settings.manage" : "settings.view";
  if (url.startsWith("/api/v1/admin/point-types"))
    return write ? "point_type.manage" : "point_type.view";
  if (url.startsWith("/api/v1/admin/issuance-rules"))
    return write ? "issuance.manage" : "issuance.view";
  if (url.startsWith("/api/v1/admin/issuance-proposals")) return "wallet.adjust";
  if (url.startsWith("/api/v1/admin/member-fields"))
    return write ? "member.manage" : null;
  if (url.startsWith("/api/v1/admin/project-fields") || url.startsWith("/api/v1/admin/projects"))
    return write ? "project.manage" : "project.view";
  if (url.startsWith("/api/v1/admin/logs")) return "audit.view";
  if (url.startsWith("/api/v1/admin/event-definitions"))
    return write ? "event.manage" : "event.view";
  if (url.startsWith("/api/v1/admin/members")) return write ? "member.manage" : "member.view";
  if (url.includes("/credits/audit")) return "audit.view";
  if (url.includes("/credits/bank")) return write ? "bank.manage" : "bank.view";
  if (url.includes("/credits/exchange-requests/") && url.endsWith("/approve"))
    return "exchange.approve";
  if (url.includes("/credits/exchange-requests/") && url.endsWith("/complete"))
    return "exchange.complete";
  if (url.includes("/credits/exchange")) return write ? "exchange.manage" : "exchange.view";
  if (url.startsWith("/api/v1/admin/credits/categories"))
    return write ? "recognition.manage" : "recognition.view";
  if (url.startsWith("/api/v1/admin/credits")) return write ? "wallet.adjust" : "wallet.view";
  if (url.startsWith("/api/v1/admin/giftcards"))
    return write ? "giftcard.manage" : "giftcard.view";
  if (url.startsWith("/api/v1/admin/rewards"))
    return write ? "reward.manage" : "reward.view";
  if (url.startsWith("/api/v1/admin/campaigns/") && url.endsWith("/run-now"))
    return "campaign.execute";
  if (url.startsWith("/api/v1/admin/campaigns"))
    return write ? "campaign.manage" : "campaign.view";
  if (url.startsWith("/api/v1/admin/segments"))
    return write ? "segment.manage" : "segment.view";
  if (url.startsWith("/api/v1/admin/coupons"))
    return write ? "coupon.manage" : "coupon.view";
  if (url.startsWith("/api/v1/admin/badges"))
    return write ? "badge.manage" : "badge.view";
  if (url.startsWith("/api/v1/admin/tiers"))
    return write ? "tier.manage" : "tier.view";
  if (url.startsWith("/api/v1/admin/coalition"))
    return write ? "coalition.manage" : "coalition.view";
  if (url.startsWith("/api/v1/admin/notification-templates/") && url.endsWith("/preview"))
    return "notification.view";
  if (url.startsWith("/api/v1/admin/notification") || url.startsWith("/api/v1/admin/webhooks"))
    return write ? "notification.manage" : "notification.view";
  if (url.startsWith("/api/v1/admin/programs"))
    return write ? "settings.manage" : "settings.view";
  return null;
}
