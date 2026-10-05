import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  decideApprovalRequest,
  getApprovalRequest,
  listApprovalRequests,
} from "../../lib/approval-workflows.js";
import { audit } from "../../lib/audit.js";
import { withApprovalDisplay } from "../../lib/approval-display.js";
import { LoyaltyError } from "../../lib/errors.js";
import { requireCapability } from "../../lib/permissions.js";
import { pointExchangeApprovalHook } from "../../lib/workflow-integrations.js";
import { notifyCreditExchangeDecision } from "../../lib/member-notifications.js";
import { notificationsService } from "../../lib/notifications-setup.js";
import { createAdminActivityNotification } from "../../lib/admin-notifications.js";
import { runOccasions } from "../../workers/occasions.js";
import { prisma } from "../../db.js";

const pageQuery = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
});

function adminId(request: { adminId: string | null }): string {
  if (!request.adminId) throw new LoyaltyError("ADMIN_SESSION_REQUIRED", 403);
  return request.adminId;
}

export function adminApprovalsRoutes(
  app: FastifyInstance,
  _opts: unknown,
  done: () => void,
): void {
  app.get(
    "/admin/approvals/inbox",
    { preHandler: [requireCapability("approval.inbox")] },
    async (request, reply) => {
      const currentAdminId = adminId(request);
      const [pending, submittedOutcomes] = await Promise.all([
        listApprovalRequests(request.programId, { inboxForAdminId: currentAdminId }),
        listApprovalRequests(request.programId, { requesterAdminId: currentAdminId, take: 50 }),
      ]);
      const byId = new Map([...submittedOutcomes, ...pending].map((item) => [item.id, item]));
      const items = [...byId.values()].sort((left, right) => right.requestedAt.getTime() - left.requestedAt.getTime()).slice(0, 100);
      return reply.send({
        data: await withApprovalDisplay(request.programId, items),
      });
    },
  );

  app.get(
    "/admin/approvals/inbox/unread-count",
    { preHandler: [requireCapability("approval.inbox")] },
    async (request, reply) => {
      const currentAdminId = adminId(request);
      const pending = await listApprovalRequests(request.programId, { inboxForAdminId: currentAdminId });
      const unreadOutcomes = await prisma.approvalRequest.count({
        where: {
          programId: request.programId,
          requesterAdminId: currentAdminId,
          status: { in: ["APPROVED", "REJECTED", "CANCELLED"] },
          adminNotificationReads: { none: { adminUserId: currentAdminId } },
        },
      });
      return reply.send({ data: { unreadCount: pending.filter((item) => !("isRead" in item) || !item.isRead).length + unreadOutcomes } });
    },
  );

  app.post(
    "/admin/approvals/read-state",
    { preHandler: [requireCapability("approval.inbox")] },
    async (request, reply) => {
      const body = z.object({
        ids: z.array(z.string().min(1)).max(200).optional().default([]),
        isRead: z.boolean(),
        all: z.boolean().optional().default(false),
      }).parse(request.body);
      const currentAdminId = adminId(request);
      const requestedIds = [...new Set(body.ids)];
      const [inbox, submittedOutcomes] = await Promise.all([
        listApprovalRequests(request.programId, { inboxForAdminId: currentAdminId }),
        listApprovalRequests(request.programId, { requesterAdminId: currentAdminId }),
      ]);
      const allowedIds = new Set([...inbox, ...submittedOutcomes].map((item) => item.id));
      if (body.all) requestedIds.push(...allowedIds);
      if (requestedIds.some((id) => !allowedIds.has(id)))
        throw new LoyaltyError("APPROVAL_REQUEST_NOT_IN_INBOX", 404);
      if (requestedIds.length === 0) return reply.status(204).send();
      if (body.isRead && requestedIds.length > 0) {
        await prisma.adminApprovalNotificationRead.createMany({
          data: requestedIds.map((approvalRequestId) => ({ adminUserId: currentAdminId, approvalRequestId })),
          skipDuplicates: true,
        });
      } else if (requestedIds.length > 0) {
        await prisma.adminApprovalNotificationRead.deleteMany({
          where: { adminUserId: currentAdminId, approvalRequestId: { in: requestedIds } },
        });
      }
      return reply.status(204).send();
    },
  );

  app.get(
    "/admin/approvals/history",
    { preHandler: [requireCapability("approval.view")] },
    async (request, reply) => {
      const query = pageQuery.parse(request.query);
      return reply.send({
        data: await withApprovalDisplay(request.programId, await listApprovalRequests(request.programId, { status: query.status, resolvedOnly: query.status === undefined })),
      });
    },
  );

  app.get(
    "/admin/approvals/:id",
    { preHandler: [requireCapability("approval.view")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const [data] = await withApprovalDisplay(request.programId, [await getApprovalRequest(request.programId, id)]);
      return reply.send({ data });
    },
  );

  const decision = (kind: "APPROVE" | "REJECT") =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = z
        .object({ comment: z.string().trim().max(2000).optional() })
        .default({})
        .parse(request.body);
      const result = await decideApprovalRequest(
        request.programId,
        id,
        adminId(request),
        kind,
        body.comment,
        pointExchangeApprovalHook,
      );
      if (result.status === "APPROVED" || result.status === "REJECTED" || result.status === "CANCELLED") {
        const requestOwner = await prisma.approvalRequest.findFirst({
          where: { id, programId: request.programId },
          select: { requesterAdminId: true, actionKey: true, subjectType: true, subjectId: true, resolutionComment: true },
        });
        if (requestOwner?.requesterAdminId) {
          await prisma.adminApprovalNotificationRead.deleteMany({
            where: { adminUserId: requestOwner.requesterAdminId, approvalRequestId: id },
          });
          const outcome = result.status.toLowerCase();
          await createAdminActivityNotification({
            programId: request.programId,
            adminUserId: requestOwner.requesterAdminId,
            triggerEvent: "admin.approval.resolved",
            idempotencyKey: `approval-resolved:${id}:${result.status}`,
            title: `Approval ${outcome}`,
            body: `Your ${requestOwner.actionKey.replaceAll("_", " ").toLowerCase()} request was ${outcome}. ${requestOwner.resolutionComment ?? ""}`.trim(),
            actionUrl: requestOwner.subjectType === "Project" ? `/projects?project=${encodeURIComponent(requestOwner.subjectId)}` : `/approvals?request=${encodeURIComponent(id)}`,
            entityType: requestOwner.subjectType,
            entityId: requestOwner.subjectId,
            context: {
              approval: {
                actionKey: requestOwner.actionKey,
                status: outcome,
                subjectType: requestOwner.subjectType,
                subjectId: requestOwner.subjectId,
                comment: requestOwner.resolutionComment ?? "",
              },
            },
          }).catch((error: unknown) => request.log.warn({ err: error, approvalRequestId: id }, "Failed to notify approval requester"));
        }
      }
      if (kind === "APPROVE" && result.actionKey === "CAMPAIGN_ISSUANCE_PROPOSAL" && result.status === "APPROVED") {
        void runOccasions().catch((error: unknown) => {
          request.log.error({ err: error, approvalRequestId: id }, "Failed to run approved campaign occasions");
        });
      }
      if (result.actionKey === "POINT_EXCHANGE" && (result.status === "APPROVED" || result.status === "REJECTED")) {
        await notifyCreditExchangeDecision(request.programId, result.subjectId, result.status);
      }
      if (result.actionKey === "REWARD_REDEMPTION" && result.status === "REJECTED") {
        const redemption = await prisma.rewardRedemption.findFirst({
          where: { id: result.subjectId, reward: { programId: request.programId } },
          include: {
            reward: { select: { id: true, name: true } },
            pointType: { select: { id: true, code: true, name: true, unitLabel: true } },
            member: {
              select: {
                id: true, email: true, phone: true, firstName: true, lastName: true, locale: true,
                program: { select: { defaultLocale: true } },
              },
            },
          },
        });
        if (redemption) {
          const approval = await prisma.approvalRequest.findUnique({ where: { id }, select: { resolutionComment: true } });
          await notificationsService.sendTrigger(request.programId, "reward.redemption.rejected", redemption.memberId, {
            member: redemption.member,
            reward: redemption.reward,
            pointType: redemption.pointType,
            pointsSpent: redemption.pointsSpent,
            reason: approval?.resolutionComment ?? body.comment ?? "",
            _locale: redemption.member.locale ?? redemption.member.program.defaultLocale ?? "vi-VN",
          }).catch((error: unknown) => request.log.warn({ err: error, redemptionId: redemption.id }, "Failed to notify rejected reward redemption"));
        }
      }
      if (result.actionKey === "POINT_ISSUANCE_PROPOSAL" && result.status === "APPROVED") {
        const approval = await prisma.approvalRequest.findUnique({ where: { id }, select: { payload: true } });
        const payload = approval?.payload && typeof approval.payload === "object" ? approval.payload as Record<string, unknown> : {};
        const [member, pointType] = await Promise.all([
          prisma.member.findFirst({
            where: { id: result.subjectId, programId: request.programId },
            select: { id: true, email: true, phone: true, firstName: true, lastName: true, locale: true, program: { select: { defaultLocale: true } } },
          }),
          typeof payload.pointTypeId === "string"
            ? prisma.pointTypeDefinition.findFirst({ where: { id: payload.pointTypeId, programId: request.programId }, select: { id: true, code: true, name: true, unitLabel: true } })
            : Promise.resolve(null),
        ]);
        if (member && pointType) {
          await notificationsService.sendTrigger(request.programId, "credit.admin_issued", member.id, {
            member, pointType, amount: payload.amount, reason: payload.reason,
            _locale: member.locale ?? member.program.defaultLocale ?? "vi-VN",
          }).catch((error: unknown) => request.log.warn({ err: error, memberId: member.id }, "Failed to notify approved point issuance"));
        }
      }
      if (result.actionKey === "PROJECT_POINT_ISSUANCE" && result.status === "APPROVED") {
        const batch = await prisma.projectIssueBatch.findFirst({
          where: { id: result.subjectId, project: { programId: request.programId } },
          include: {
            project: { select: { name: true } },
            allocations: {
              include: {
                pointType: { select: { id: true, code: true, name: true, unitLabel: true } },
                member: {
                  select: { id: true, email: true, phone: true, firstName: true, lastName: true, locale: true, program: { select: { defaultLocale: true } } },
                },
              },
            },
          },
        });
        if (batch) {
          const recipientAllocations = new Map<string, { allocation: (typeof batch.allocations)[number]; amount: number }>();
          for (const allocation of batch.allocations) {
            const key = `${allocation.memberId}:${allocation.pointTypeId}`;
            const current = recipientAllocations.get(key);
            recipientAllocations.set(key, {
              allocation: current?.allocation ?? allocation,
              amount: (current?.amount ?? 0) + allocation.amount,
            });
          }
          await Promise.all([...recipientAllocations.entries()].map(async ([key, { allocation, amount }]) =>
            notificationsService.sendTrigger(request.programId, "project.points.issued", allocation.memberId, {
              member: allocation.member,
              project: { name: batch.project.name },
              pointType: allocation.pointType,
              amount,
              _locale: allocation.member.locale ?? allocation.member.program.defaultLocale ?? "vi-VN",
            }).catch((error: unknown) => request.log.warn({ err: error, allocationKey: key }, "Failed to notify project point recipient")),
          ));
        }
      }
      await audit(request.programId, request.actor, "CONFIG_CHANGE", "approval_request", id, {
        operation: kind,
        actionKey: result.actionKey,
        subjectType: result.subjectType,
        subjectId: result.subjectId,
        status: result.status,
        comment: body.comment ?? null,
      });
      return reply.send({ data: result });
    };

  app.post(
    "/admin/approvals/:id/approve",
    { preHandler: [requireCapability("approval.decide")] },
    decision("APPROVE"),
  );
  app.post(
    "/admin/approvals/:id/reject",
    { preHandler: [requireCapability("approval.decide")] },
    decision("REJECT"),
  );

  done();
}
