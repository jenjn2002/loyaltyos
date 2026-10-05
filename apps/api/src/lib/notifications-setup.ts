import {
  createOneSignalProvider,
  createSmtpProvider,
  createTwilioProvider,
  NoopProvider,
  NotificationsService,
  SmtpProvider,
  WebhookProvider,
} from "@loyaltyos/notifications";

import { prisma } from "../db.js";
import { auditMemberNotificationDeliveryFailure } from "./notification-delivery-audit.js";
import { createQueue } from "./queue.js";

/** Shared notifications service, configured with providers and BullMQ enqueue. */
export const notificationsService = new NotificationsService(prisma);

// Register EMAIL provider; also used by the separate admin-activity email stream.
export const emailNotificationProvider = createSmtpProvider();
notificationsService.setProvider("EMAIL", emailNotificationProvider);
// IN_APP notifications are already persisted for the portal; the no-op provider
// lets the notification worker mark them delivered without an external service.
notificationsService.setProvider("IN_APP", new NoopProvider("IN_APP"));

// Register SMS provider (no-op when env vars not set)
const smsProvider = createTwilioProvider();
if (smsProvider) {
  notificationsService.setProvider("SMS", smsProvider);
}

// Register PUSH provider (no-op when env vars not set)
const pushProvider = createOneSignalProvider();
if (pushProvider) {
  notificationsService.setProvider("PUSH", pushProvider);
}

// Wire BullMQ enqueue
const notificationsQueue = createQueue("notifications");

notificationsService.setEnqueue(async (notificationId: string) => {
  try {
    await notificationsQueue.add("send", { notificationId });
  } catch (error) {
    try {
      await auditMemberNotificationDeliveryFailure(notificationId, {
        failureStage: "ENQUEUE",
        attemptNumber: 0,
        error,
      });
    } catch (auditError) {
      console.error("[Notifications] Could not audit notification enqueue failure:", auditError);
    }
    throw error;
  }
});

notificationsService.setDeliveryFailureObserver(async ({ notificationId, error, failureStage, attemptNumber, fallbackChannel }) => {
  await auditMemberNotificationDeliveryFailure(notificationId, {
    failureStage,
    attemptNumber,
    fallbackChannel,
    error,
  });
});

export { notificationsQueue };
export { SmtpProvider, WebhookProvider };
