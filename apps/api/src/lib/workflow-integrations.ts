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
  if (request.actionKey === "PROJECT_PLAN_APPROVAL" && request.subjectType === "Project") {
    const project = await tx.project.findFirst({
      where: { id: request.subjectId, programId: request.programId },
      include: { budgets: { include: { pointType: { select: { code: true, bankEnabled: true } } } } },
    });
    if (!project) throw new Error("Project not found for approval");
    if (decision === "REJECT") {
      await tx.project.update({ where: { id: project.id }, data: { status: "PLAN_REJECTED" } });
      return;
    }
    if (project.status !== "PLAN_PENDING") throw new Error("Project plan is no longer pending");
    for (const budget of project.budgets) {
      if (!budget.pointType.bankEnabled) throw new Error("Project budgets require bank-enabled point types");
      if (budget.requestedAmount <= 0) continue;
      await walletService.reserveProjectBudgetWithTransaction(tx, {
        programId: request.programId,
        pointTypeId: budget.pointTypeId,
        amount: budget.requestedAmount,
        projectId: project.id,
        actorId,
        idempotencyKey: `project:${project.id}:fund:${budget.pointTypeId}`,
      });
      await tx.projectPointBudget.update({
        where: { id: budget.id },
        data: { approvedAmount: budget.requestedAmount, remainingAmount: budget.requestedAmount },
      });
      await tx.projectBudgetTransaction.create({
        data: {
          projectId: project.id,
          budgetId: budget.id,
          programId: request.programId,
          pointTypeId: budget.pointTypeId,
          type: "FUNDED",
          amount: budget.requestedAmount,
          balanceAfter: budget.requestedAmount,
          reason: `Approved project budget for ${project.name}`,
          actorId,
          idempotencyKey: `fund:${budget.pointTypeId}`,
        },
      });
    }
    await tx.project.update({ where: { id: project.id }, data: { status: "APPROVED" } });
    return;
  }
  if (request.actionKey === "PROJECT_POINT_ISSUANCE" && request.subjectType === "ProjectIssueBatch") {
    const batch = await tx.projectIssueBatch.findFirst({
      where: { id: request.subjectId },
      include: { project: true, allocations: { include: { budget: true, pointType: { select: { code: true, name: true } } } } },
    });
    if (!batch) throw new Error("Project issue batch not found");
    if (decision === "REJECT") {
      await tx.projectIssueBatch.update({ where: { id: batch.id }, data: { status: "REJECTED", resolvedAt: new Date() } });
      await tx.project.update({ where: { id: batch.projectId }, data: { status: "ISSUE_REJECTED" } });
      return;
    }
    if (batch.status !== "PENDING") throw new Error("Project issue batch is no longer pending");
    for (const allocation of batch.allocations) {
      const changed = await tx.projectPointBudget.updateMany({
        where: { id: allocation.budgetId, remainingAmount: { gte: allocation.amount } },
        data: { remainingAmount: { decrement: allocation.amount }, issuedAmount: { increment: allocation.amount } },
      });
      if (changed.count !== 1) throw new Error("Project escrow balance is insufficient");
      const result = await walletService.issueWithTransaction(tx, {
        memberId: allocation.memberId,
        programId: request.programId,
        amount: allocation.amount,
        source: `project:${batch.projectId}`,
        reason: `Project reward · ${batch.project.name}`,
        idempotencyKey: `project:${batch.projectId}:batch:${batch.id}:${allocation.id}`,
        pointTypeId: allocation.pointTypeId,
        metadata: { projectId: batch.projectId, projectName: batch.project.name, issueBatchId: batch.id },
        skipBankDebit: true,
      });
      await tx.projectGrantAllocation.update({ where: { id: allocation.id }, data: { transactionId: result.transactionId } });
      const current = await tx.projectPointBudget.findUniqueOrThrow({ where: { id: allocation.budgetId } });
      await tx.projectBudgetTransaction.create({
        data: {
          projectId: batch.projectId,
          budgetId: allocation.budgetId,
          programId: request.programId,
          pointTypeId: allocation.pointTypeId,
          type: "ISSUED",
          amount: -allocation.amount,
          balanceAfter: current.remainingAmount,
          reason: `Issued to project member · ${allocation.memberId}`,
          actorId,
          idempotencyKey: `issue:${batch.id}:${allocation.id}`,
        },
      });
    }
    await tx.projectIssueBatch.update({ where: { id: batch.id }, data: { status: "APPROVED", resolvedAt: new Date() } });
    await tx.project.update({ where: { id: batch.projectId }, data: { status: "ISSUED" } });
    return;
  }
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
