import type { NotificationChannel } from "@prisma/client";

import { prisma } from "../db.js";
import { audit } from "./audit.js";

export interface NotificationDeliveryFailureInput {
  programId: string;
  notificationId: string;
  channel: NotificationChannel | string;
  templateId?: string | null;
  triggerEvent?: string | null;
  memberId?: string | null;
  adminUserId?: string | null;
  failureStage: "ENQUEUE" | "DELIVERY" | "PRIMARY_DELIVERY";
  attemptNumber?: number;
  fallbackChannel?: NotificationChannel | string | null;
  error: unknown;
}

function safeErrorSummary(error: unknown): { errorType: string; errorSummary: string } {
  const errorType = error instanceof Error ? error.name : "DeliveryError";
  const rawMessage = error instanceof Error ? error.message : String(error);
  const errorSummary = rawMessage
    .replace(/smtps?:\/\/[^\s/@:]+:[^\s/@]+@/gi, (url) => `${url.slice(0, url.indexOf("://") + 3)}[redacted]@`)
    .replace(/\b(password|pass|secret|token|authorization|api[_ -]?key)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1$2[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
  return { errorType: errorType.slice(0, 100), errorSummary };
}

export async function auditNotificationDeliveryFailure(
  input: NotificationDeliveryFailureInput,
): Promise<void> {
  const { errorType, errorSummary } = safeErrorSummary(input.error);
  await audit(
    input.programId,
    { type: "SYSTEM", id: "notification-delivery" },
    "NOTIFICATION_DELIVERY_FAILED",
    "notification_delivery",
    input.notificationId,
    {
      notificationId: input.notificationId,
      channel: input.channel,
      failureStage: input.failureStage,
      errorSummary,
      errorType,
      attemptNumber: input.attemptNumber ?? null,
      fallbackDelivered: input.failureStage === "PRIMARY_DELIVERY",
      templateId: input.templateId ?? null,
      triggerEvent: input.triggerEvent ?? null,
      memberId: input.memberId ?? null,
      adminUserId: input.adminUserId ?? null,
      fallbackChannel: input.fallbackChannel ?? null,
    },
    errorSummary,
  );
}

export async function auditMemberNotificationDeliveryFailure(
  notificationId: string,
  details: Pick<NotificationDeliveryFailureInput, "failureStage" | "attemptNumber" | "fallbackChannel" | "error">,
): Promise<void> {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: {
      id: true,
      channel: true,
      templateId: true,
      memberId: true,
      template: { select: { triggerEvent: true, fallbackChannel: true } },
      member: { select: { programId: true } },
    },
  });
  if (!notification) return;

  await auditNotificationDeliveryFailure({
    programId: notification.member.programId,
    notificationId,
    channel: notification.channel,
    templateId: notification.templateId,
    triggerEvent: notification.template?.triggerEvent,
    memberId: notification.memberId,
    ...details,
    fallbackChannel: details.fallbackChannel ?? notification.template?.fallbackChannel,
  });
}

export async function auditAdminNotificationDeliveryFailure(
  notificationId: string,
  details: Pick<NotificationDeliveryFailureInput, "failureStage" | "attemptNumber" | "error">,
): Promise<void> {
  const notification = await prisma.adminNotification.findUnique({
    where: { id: notificationId },
    select: { id: true, programId: true, adminUserId: true, triggerEvent: true },
  });
  if (!notification) return;

  await auditNotificationDeliveryFailure({
    programId: notification.programId,
    notificationId,
    channel: "EMAIL",
    triggerEvent: notification.triggerEvent,
    adminUserId: notification.adminUserId,
    ...details,
  });
}
