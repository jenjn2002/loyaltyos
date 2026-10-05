import { render, toPlainText, type NotificationRow } from "@loyaltyos/notifications";

import { prisma } from "../db.js";
import { auditAdminNotificationDeliveryFailure } from "./notification-delivery-audit.js";
import { emailNotificationProvider, notificationsQueue } from "./notifications-setup.js";

export interface AdminActivityNotificationInput {
  programId: string;
  adminUserId: string;
  triggerEvent: string;
  idempotencyKey: string;
  title: string;
  body: string;
  actionUrl?: string;
  entityType?: string;
  entityId?: string;
  context?: Record<string, unknown>;
}

function plainBody(value: string): string {
  return toPlainText(value).slice(0, 4000);
}

function renderTemplate(value: string | null | undefined, context: Record<string, unknown>, fallback: string): string {
  return value ? render(value, context) : fallback;
}

/** Persist an admin's in-app activity and queue its matching email. Business mutations
 * must not fail if the optional email queue is temporarily unavailable. */
export async function createAdminActivityNotification(input: AdminActivityNotificationInput) {
  const prior = await prisma.adminNotification.findUnique({
    where: { adminUserId_idempotencyKey: { adminUserId: input.adminUserId, idempotencyKey: input.idempotencyKey } },
  });
  if (prior) return prior;

  const [admin, program] = await Promise.all([
    prisma.adminUser.findFirst({
      where: { id: input.adminUserId, programId: input.programId, isActive: true },
      select: { id: true, email: true, locale: true },
    }),
    prisma.program.findUnique({ where: { id: input.programId }, select: { defaultLocale: true } }),
  ]);
  if (!admin) return null;

  const context = input.context ?? {};
  const locales = [...new Set([admin.locale, program?.defaultLocale, "en-US", "en"].filter((locale): locale is string => Boolean(locale)))];
  const preferredLocale = locales[0] ?? "vi-VN";
  const isVietnamese = preferredLocale.toLowerCase().startsWith("vi");
  const labels: Record<string, string> = isVietnamese
    ? { accepted: "chấp nhận", declined: "từ chối", approved: "được phê duyệt", rejected: "bị từ chối", cancelled: "bị hủy" }
    : { accepted: "accepted", declined: "declined", approved: "approved", rejected: "rejected", cancelled: "cancelled" };
  const approvalContext = context.approval && typeof context.approval === "object" && !Array.isArray(context.approval)
    ? context.approval as Record<string, unknown>
    : null;
  const templateContext = {
    ...context,
    ...(typeof context.response === "string" ? { responseLabel: labels[context.response] ?? context.response } : {}),
    ...(approvalContext ? {
      approval: {
        ...approvalContext,
        statusLabel: typeof approvalContext.status === "string" ? labels[approvalContext.status] ?? approvalContext.status : "",
      },
    } : {}),
  };
  const templates = await prisma.notificationTemplate.findMany({
    where: {
      programId: input.programId,
      triggerEvent: input.triggerEvent,
      channel: { in: ["IN_APP", "EMAIL"] },
      locale: { in: locales },
    },
  });
  const findTemplate = (channel: "IN_APP" | "EMAIL") =>
    locales.map((locale) => templates.find((template) => template.channel === channel && template.locale === locale)).find(Boolean);
  const inApp = findTemplate("IN_APP");
  const email = findTemplate("EMAIL");

  const title = renderTemplate(inApp?.subject, templateContext, input.title).slice(0, 240);
  const body = plainBody(renderTemplate(inApp?.bodyText ?? inApp?.bodyHtml, templateContext, input.body));
  const emailSubject = renderTemplate(email?.subject, templateContext, title).slice(0, 240);
  const emailBodyTemplate = email?.bodyHtml ?? email?.bodyText;
  const emailBody = renderTemplate(emailBodyTemplate, templateContext, body).slice(0, 20_000);

  let notification;
  try {
    notification = await prisma.adminNotification.create({
      data: {
        programId: input.programId,
        adminUserId: input.adminUserId,
        triggerEvent: input.triggerEvent,
        idempotencyKey: input.idempotencyKey,
        title,
        body,
        actionUrl: input.actionUrl,
        entityType: input.entityType,
        entityId: input.entityId,
        emailSubject,
        emailBody,
        emailStatus: admin.email ? "PENDING" : "SKIPPED_NO_EMAIL",
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return prisma.adminNotification.findUnique({
        where: { adminUserId_idempotencyKey: { adminUserId: input.adminUserId, idempotencyKey: input.idempotencyKey } },
      });
    }
    throw error;
  }

  if (admin.email) {
    try {
      await notificationsQueue.add("send-admin", { adminNotificationId: notification.id }, {
        jobId: `admin-notification-${notification.id}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.adminNotification.update({
        where: { id: notification.id },
        data: { emailStatus: "FAILED", emailError: message.slice(0, 1000) },
      });
      console.error(`[Notifications] Could not enqueue admin email for ${input.triggerEvent}:`, message);
      try {
        await auditAdminNotificationDeliveryFailure(notification.id, {
          failureStage: "ENQUEUE",
          attemptNumber: 0,
          error,
        });
      } catch (auditError) {
        console.error("[Notifications] Could not audit admin email enqueue failure:", auditError);
      }
    }
  }
  return notification;
}

/** Notify the admins assigned to the currently-open approval step. Call only
 * after the request transaction commits; the idempotency key makes repeated
 * calls (including later approvals in another step) safe. */
export async function notifyApprovalAssignees(programId: string, approvalRequestId: string): Promise<void> {
  const request = await prisma.approvalRequest.findFirst({
    where: { id: approvalRequestId, programId, status: "PENDING", currentStepOrder: { not: null } },
    select: {
      id: true,
      actionKey: true,
      subjectType: true,
      subjectId: true,
      currentStepOrder: true,
      workflowSnapshot: true,
      steps: { where: { status: "PENDING" }, select: { stepOrder: true, assigneesSnapshot: true } },
    },
  });
  if (!request || request.currentStepOrder == null) return;
  const step = request.steps.find((item) => item.stepOrder === request.currentStepOrder);
  if (!step || !Array.isArray(step.assigneesSnapshot)) return;
  const adminIds = [...new Set(step.assigneesSnapshot.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const adminId = (item as Record<string, unknown>).adminId;
    return typeof adminId === "string" ? [adminId] : [];
  }))];
  if (!adminIds.length) return;
  const admins = await prisma.adminUser.findMany({
    where: { programId, id: { in: adminIds }, isActive: true },
    select: { id: true },
  });
  const snapshot = request.workflowSnapshot && typeof request.workflowSnapshot === "object" && !Array.isArray(request.workflowSnapshot)
    ? request.workflowSnapshot as Record<string, unknown>
    : {};
  const workflowName = typeof snapshot.name === "string" ? snapshot.name : request.actionKey.replaceAll("_", " ");
  const outcomes = await Promise.allSettled(admins.map((admin) => createAdminActivityNotification({
    programId,
    adminUserId: admin.id,
    triggerEvent: "admin.approval.pending",
    idempotencyKey: `approval-pending:${request.id}:${step.stepOrder}:${admin.id}`,
    title: "Approval needed",
    body: `${workflowName} requires your review.`,
    actionUrl: `/approvals?request=${encodeURIComponent(request.id)}`,
    entityType: request.subjectType,
    entityId: request.subjectId,
    context: {
      approval: { id: request.id, actionKey: request.actionKey, status: "pending", subjectType: request.subjectType, subjectId: request.subjectId },
      workflow: { name: workflowName },
    },
  })));
  outcomes.forEach((outcome) => {
    if (outcome.status === "rejected") console.error("[Notifications] Failed to create approval-request notification", outcome.reason);
  });
}

export async function deliverAdminActivityEmail(notificationId: string, finalAttempt = false): Promise<void> {
  const notification = await prisma.adminNotification.findUnique({
    where: { id: notificationId },
    include: { adminUser: { select: { email: true, isActive: true } } },
  });
  if (!notification || notification.emailStatus === "SENT" || notification.emailStatus === "SKIPPED_NO_EMAIL") return;
  if (!notification.adminUser.isActive || !notification.adminUser.email) {
    await prisma.adminNotification.update({
      where: { id: notification.id },
      data: { emailStatus: "SKIPPED_NO_EMAIL", emailError: null },
    });
    return;
  }

  const result = await emailNotificationProvider.send({
    id: notification.id,
    memberId: "",
    channel: "EMAIL",
    status: "PENDING",
    subject: notification.emailSubject ?? notification.title,
    body: notification.emailBody ?? notification.body,
    metadata: { email: notification.adminUser.email },
    createdAt: notification.createdAt,
    sentAt: null,
    readAt: null,
    error: null,
    templateId: null,
  } as NotificationRow);

  if (!result.success) {
    await prisma.adminNotification.update({
      where: { id: notification.id },
      data: {
        emailStatus: finalAttempt ? "FAILED" : "PENDING",
        emailError: result.error?.slice(0, 1000) ?? "Email provider failed",
      },
    });
    throw new Error(result.error ?? "Admin notification email failed");
  }

  await prisma.adminNotification.update({
    where: { id: notification.id },
    data: { emailStatus: "SENT", emailSentAt: new Date(), emailError: null },
  });
}
