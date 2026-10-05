import { prisma } from "../db.js";
import { notificationsService } from "./notifications-setup.js";

/** Notify a member when an administrator changes their balance directly. */
export async function notifyCreditAdjustment(
  programId: string,
  memberId: string,
  pointTypeId: string,
  amount: number,
  reason: string,
): Promise<void> {
  try {
    const [member, pointType] = await Promise.all([
      prisma.member.findFirst({
        where: { id: memberId, programId },
        select: { id: true, email: true, phone: true, firstName: true, lastName: true, locale: true, program: { select: { defaultLocale: true } } },
      }),
      prisma.pointTypeDefinition.findFirst({
        where: { id: pointTypeId, programId },
        select: { id: true, code: true, name: true, unitLabel: true },
      }),
    ]);
    if (!member || !pointType) return;
    await notificationsService.sendTrigger(programId, "credit.adjusted", memberId, {
      member,
      pointType,
      amount,
      reason,
      _locale: member.locale ?? member.program.defaultLocale ?? "vi-VN",
    });
  } catch (error) {
    console.error("[Notifications] Failed to notify credit adjustment", { memberId, pointTypeId, error });
  }
}

/** Notify a member after an exchange approval workflow reaches a final decision. */
export async function notifyCreditExchangeDecision(
  programId: string,
  requestId: string,
  status: "APPROVED" | "REJECTED" | "COMPLETED" | "CANCELLED",
): Promise<void> {
  try {
    const request = await prisma.pointExchangeRequest.findFirst({
      where: { id: requestId, programId },
      select: {
        memberId: true,
        amount: true,
        documentNumber: true,
        completionReference: true,
        completionNote: true,
        cancellationReason: true,
        member: {
          select: {
            email: true,
            phone: true,
            locale: true,
            program: { select: { defaultLocale: true } },
          },
        },
        pointType: { select: { id: true, code: true, name: true, unitLabel: true } },
      },
    });
    if (!request) return;
    await notificationsService.sendTrigger(
      programId,
      status === "APPROVED"
        ? "credit.exchange.approved"
        : status === "REJECTED"
          ? "credit.exchange.rejected"
          : status === "COMPLETED"
            ? "credit.exchange.completed"
            : "credit.exchange.cancelled",
      request.memberId,
      {
        amount: request.amount,
        documentNumber: request.documentNumber,
        completionReference: request.completionReference,
        completionNote: request.completionNote,
        cancellationReason: request.cancellationReason,
        pointType: request.pointType,
        member: request.member,
        status,
        _locale: request.member.locale ?? request.member.program.defaultLocale ?? "vi-VN",
      },
    );
  } catch (error) {
    console.error("[Notifications] Failed to notify exchange decision", { requestId, status, error });
  }
}
