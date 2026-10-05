CREATE TABLE "AdminNotification" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "triggerEvent" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actionUrl" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "emailSubject" TEXT,
    "emailBody" TEXT,
    "emailStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "emailError" TEXT,
    "emailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminNotification_adminUserId_idempotencyKey_key"
ON "AdminNotification"("adminUserId", "idempotencyKey");

CREATE INDEX "AdminNotification_programId_adminUserId_readAt_createdAt_idx"
ON "AdminNotification"("programId", "adminUserId", "readAt", "createdAt");

CREATE INDEX "AdminNotification_emailStatus_createdAt_idx"
ON "AdminNotification"("emailStatus", "createdAt");

ALTER TABLE "AdminNotification"
ADD CONSTRAINT "AdminNotification_programId_fkey"
FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdminNotification"
ADD CONSTRAINT "AdminNotification_adminUserId_fkey"
FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
