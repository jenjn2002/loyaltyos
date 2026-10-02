CREATE TABLE "AdminDashboardPreference" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "widgets" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminDashboardPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminDashboardPreference_programId_adminUserId_key"
ON "AdminDashboardPreference"("programId", "adminUserId");
CREATE INDEX "AdminDashboardPreference_programId_idx"
ON "AdminDashboardPreference"("programId");

ALTER TABLE "AdminDashboardPreference"
ADD CONSTRAINT "AdminDashboardPreference_programId_fkey"
FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminDashboardPreference"
ADD CONSTRAINT "AdminDashboardPreference_adminUserId_fkey"
FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
