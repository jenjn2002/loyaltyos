ALTER TABLE "EventDefinition" ADD COLUMN "automation" JSONB NOT NULL DEFAULT '{"mode":"EXTERNAL","timezone":"Asia/Ho_Chi_Minh"}', ADD COLUMN "requiresApproval" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Campaign" ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED', ADD COLUMN "justification" TEXT, ADD COLUMN "grantExpiryDays" INTEGER;
-- Existing event definitions remain external until explicitly configured by Admin.
UPDATE "EventDefinition" SET "requiresApproval" = false WHERE "key" IN ('registration','birthday','work_anniversary','company_date','purchase','referral','tier_upgrade');
UPDATE "Campaign" c SET "approvalStatus" = 'DRAFT', "isActive" = false FROM "EventDefinition" e WHERE c."programId" = e."programId" AND lower(c."eventType") = e."key" AND e."requiresApproval" = true;
