import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  decideApprovalRequest,
  getApprovalRequest,
  listApprovalRequests,
} from "../../lib/approval-workflows.js";
import { LoyaltyError } from "../../lib/errors.js";
import { requireCapability } from "../../lib/permissions.js";
import { pointExchangeApprovalHook } from "../../lib/workflow-integrations.js";

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

  app.get(
    "/admin/approvals/history",
    { preHandler: [requireCapability("approval.view")] },
    async (request, reply) => {
      const query = pageQuery.parse(request.query);
      return reply.send({
        data: await listApprovalRequests(request.programId, { status: query.status }),
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
