import type { Prisma } from "@prisma/client";

import type { ApprovalDecisionHook } from "./approval-workflows.js";
import { walletService } from "./wallets.js";

/**
 * Keeps the generic approval engine independent from wallet internals while
 * making POINT_EXCHANGE approval atomic with the voucher transition/refund.
 */
export const pointExchangeApprovalHook: ApprovalDecisionHook = async (
  tx: Prisma.TransactionClient,
  request,
  decision,
  actorId,
  comment,
) => {
  if (request.actionKey === "CAMPAIGN_ISSUANCE_PROPOSAL" && request.subjectType === "CAMPAIGN_ISSUANCE") {
    await tx.campaign.updateMany({ where: { id: request.subjectId, programId: request.programId, approvalStatus: "PENDING", deletedAt: null }, data: { approvalStatus: decision === "APPROVE" ? "APPROVED" : "REJECTED", isActive: decision === "APPROVE" } });
    return;
  }
  if (request.actionKey === "POINT_EXCHANGE" && request.subjectType === "PointExchangeRequest") {
    await walletService.updateExchangeRequestWithTransaction(
      tx,
      request.programId,
      request.subjectId,
      decision === "APPROVE" ? "APPROVED" : "REJECTED",
      { type: "ADMIN_USER", id: actorId },
      decision === "APPROVE"
        ? { note: comment }
        : { reason: comment ?? "Rejected by approval workflow" },
    );
    return;
  }
  if (request.actionKey === "REWARD_REDEMPTION" && request.subjectType === "RewardRedemption") {
    if (decision === "REJECT") {
      await walletService.cancelRewardRedemptionWithTransaction(
        tx,
        request.programId,
        request.subjectId,
        { type: "ADMIN_USER", id: actorId },
        comment ?? "Rejected by approval workflow",
        false,
      );
    }
  }
  if (request.actionKey === "POINT_ISSUANCE_PROPOSAL" && decision === "APPROVE") {
    const approvalRequest = await tx.approvalRequest.findUnique({
      where: { id: request.id },
      select: { payload: true },
    });
    const payload =
      approvalRequest?.payload && typeof approvalRequest.payload === "object"
        ? (approvalRequest.payload as Record<string, unknown>)
        : {};
    const memberId = typeof payload.memberId === "string" ? payload.memberId : request.subjectId;
    const pointTypeId = typeof payload.pointTypeId === "string" ? payload.pointTypeId : "";
    const amount = typeof payload.amount === "number" ? payload.amount : 0;
    const reason = typeof payload.reason === "string" ? payload.reason : "";
    const expiresAt = typeof payload.expiresAt === "string" ? new Date(payload.expiresAt) : undefined;
    const idempotencyKey =
      typeof payload.idempotencyKey === "string"
        ? payload.idempotencyKey
        : `approval:${request.id}`;
    if (!pointTypeId || !Number.isInteger(amount) || amount <= 0 || !reason.trim())
      throw new Error("Invalid point issuance proposal payload");
    await walletService.issueWithTransaction(tx, {
      memberId,
      programId: request.programId,
      amount,
      source: `proposal:${request.id}`,
      reason: reason.trim(),
      idempotencyKey,
      pointTypeId,
      expiresAt,
    });
  }
};
