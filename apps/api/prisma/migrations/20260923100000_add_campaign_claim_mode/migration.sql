ALTER TABLE "Campaign" ADD COLUMN "issuanceMode" TEXT NOT NULL DEFAULT 'AUTO';

CREATE TABLE "CampaignClaim" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "occurrence" TEXT NOT NULL,
    "pointsAwarded" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CampaignClaim_campaignId_memberId_occurrence_key"
  ON "CampaignClaim"("campaignId", "memberId", "occurrence");
CREATE INDEX "CampaignClaim_memberId_status_idx" ON "CampaignClaim"("memberId", "status");
CREATE INDEX "CampaignClaim_campaignId_status_idx" ON "CampaignClaim"("campaignId", "status");

ALTER TABLE "CampaignClaim"
  ADD CONSTRAINT "CampaignClaim_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignClaim"
  ADD CONSTRAINT "CampaignClaim_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
