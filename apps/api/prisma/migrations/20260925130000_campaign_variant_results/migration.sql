ALTER TABLE "CampaignClaim" ADD COLUMN "variantId" TEXT;

CREATE INDEX "CampaignClaim_campaignId_variantId_idx" ON "CampaignClaim"("campaignId", "variantId");

ALTER TABLE "CampaignClaim"
ADD CONSTRAINT "CampaignClaim_variantId_fkey"
FOREIGN KEY ("variantId") REFERENCES "CampaignVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
