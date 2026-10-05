import { notificationsService } from "../lib/notifications-setup.js";
import {
  auditAdminNotificationDeliveryFailure,
  auditMemberNotificationDeliveryFailure,
} from "../lib/notification-delivery-audit.js";
import { createWorker } from "../lib/queue.js";
import { deliverAdminActivityEmail } from "../lib/admin-notifications.js";

export function startNotificationsWorker(): void {
  createWorker("notifications", async (job) => {
    const data = job.data as { notificationId?: string; adminNotificationId?: string };
    const attemptsMade = (job as typeof job & { attemptsMade?: number }).attemptsMade ?? 0;
    const attemptNumber = attemptsMade + 1;
    const bullJob = job as typeof job & { opts?: { attempts?: number } };
    const finalAttempt = attemptNumber >= (bullJob.opts?.attempts ?? 5);
    if (data.adminNotificationId) {
      try {
        await deliverAdminActivityEmail(data.adminNotificationId, finalAttempt);
      } catch (error) {
        if (finalAttempt) {
          try {
            await auditAdminNotificationDeliveryFailure(data.adminNotificationId, {
              failureStage: "DELIVERY",
              attemptNumber,
              error,
            });
          } catch (auditError) {
            console.error("[Notifications] Could not audit failed admin email:", auditError);
          }
        }
        throw error;
      }
      return;
    }
    if (!data.notificationId) throw new Error("Notification job is missing notificationId");
    try {
      await notificationsService.deliver(data.notificationId);
    } catch (error) {
      if (finalAttempt) {
        try {
          await auditMemberNotificationDeliveryFailure(data.notificationId, {
            failureStage: "DELIVERY",
            attemptNumber,
            error,
          });
        } catch (auditError) {
          console.error("[Notifications] Could not audit failed notification delivery:", auditError);
        }
      }
      throw error;
    }
  });

  console.log("[Worker] Notifications worker started");
}
