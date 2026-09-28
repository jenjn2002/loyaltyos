CREATE TABLE "CampaignManualExecution" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    CONSTRAINT "CampaignManualExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CampaignManualExecution_campaignId_key" ON "CampaignManualExecution"("campaignId");
CREATE INDEX "CampaignManualExecution_status_startedAt_idx" ON "CampaignManualExecution"("status", "startedAt");
ALTER TABLE "CampaignManualExecution" ADD CONSTRAINT "CampaignManualExecution_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
