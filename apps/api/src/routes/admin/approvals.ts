import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  decideApprovalRequest,
  getApprovalRequest,
  listApprovalRequests,
} from "../../lib/approval-workflows.js";
import { audit } from "../../lib/audit.js";
import { LoyaltyError } from "../../lib/errors.js";
import { requireCapability } from "../../lib/permissions.js";
import { pointExchangeApprovalHook } from "../../lib/workflow-integrations.js";
import { notifyCreditExchangeDecision } from "../../lib/member-notifications.js";
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
      return reply.send({
        data: await listApprovalRequests(request.programId, { inboxForAdminId: adminId(request) }),
      });
    },
  );

  app.post(
    "/admin/approvals/read-state",
    { preHandler: [requireCapability("approval.inbox")] },
    async (request, reply) => {
      const body = z.object({
        ids: z.array(z.string().min(1)).max(200),
        isRead: z.boolean(),
      }).parse(request.body);
      const currentAdminId = adminId(request);
      const requestedIds = [...new Set(body.ids)];
      const inbox = await listApprovalRequests(request.programId, { inboxForAdminId: currentAdminId });
      const inboxIds = new Set(inbox.map((item) => item.id));
      if (requestedIds.some((id) => !inboxIds.has(id)))
        throw new LoyaltyError("APPROVAL_REQUEST_NOT_IN_INBOX", 404);
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
        data: await listApprovalRequests(request.programId, { status: query.status, resolvedOnly: query.status === undefined }),
      });
    },
  );

  app.get(
    "/admin/approvals/:id",
    { preHandler: [requireCapability("approval.view")] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      return reply.send({ data: await getApprovalRequest(request.programId, id) });
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
      if (kind === "APPROVE" && result.actionKey === "CAMPAIGN_ISSUANCE_PROPOSAL" && result.status === "APPROVED") {
        void runOccasions().catch((error: unknown) => {
          request.log.error({ err: error, approvalRequestId: id }, "Failed to run approved campaign occasions");
        });
      }
      if (result.actionKey === "POINT_EXCHANGE" && (result.status === "APPROVED" || result.status === "REJECTED")) {
        await notifyCreditExchangeDecision(request.programId, result.subjectId, result.status);
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
