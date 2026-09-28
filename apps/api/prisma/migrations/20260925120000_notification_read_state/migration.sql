-- Keep delivery state separate from the IN_APP read marker. Older versions
-- used status=READ for both concepts, so preserve that fact in readAt before
-- restoring the notification's delivery status.
UPDATE "Notification"
SET "readAt" = COALESCE("readAt", "sentAt", "createdAt"),
    "status" = CASE WHEN "sentAt" IS NOT NULL THEN 'SENT'::"NotificationStatus"
                    ELSE 'PENDING'::"NotificationStatus" END
WHERE "status" = 'READ'::"NotificationStatus";
