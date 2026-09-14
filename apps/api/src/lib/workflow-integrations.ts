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
};
