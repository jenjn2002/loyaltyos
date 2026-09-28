CREATE TABLE "AdminApprovalNotificationRead" (
    "adminUserId" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminApprovalNotificationRead_pkey" PRIMARY KEY ("adminUserId", "approvalRequestId")
);

CREATE INDEX "AdminApprovalNotificationRead_approvalRequestId_idx"
ON "AdminApprovalNotificationRead"("approvalRequestId");

ALTER TABLE "AdminApprovalNotificationRead"
ADD CONSTRAINT "AdminApprovalNotificationRead_adminUserId_fkey"
FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdminApprovalNotificationRead"
ADD CONSTRAINT "AdminApprovalNotificationRead_approvalRequestId_fkey"
FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
