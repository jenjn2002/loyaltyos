import { prisma } from "../db.js";
import { notificationsService } from "./notifications-setup.js";

/** Notify a member after an exchange approval workflow reaches a final decision. */
export async function notifyCreditExchangeDecision(
  programId: string,
  requestId: string,
  status: "APPROVED" | "REJECTED",
): Promise<void> {
  try {
    const request = await prisma.pointExchangeRequest.findFirst({
      where: { id: requestId, programId },
      select: {
        memberId: true,
        amount: true,
        documentNumber: true,
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
      status === "APPROVED" ? "credit.exchange.approved" : "credit.exchange.rejected",
      request.memberId,
      {
        amount: request.amount,
        documentNumber: request.documentNumber,
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
