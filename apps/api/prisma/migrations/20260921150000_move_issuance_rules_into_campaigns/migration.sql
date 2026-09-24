ALTER TABLE "Campaign" ADD COLUMN "eventType" TEXT;

CREATE INDEX "Campaign_programId_eventType_idx" ON "Campaign"("programId", "eventType");

-- Preserve existing standing rules as regular BONUS_POINTS campaigns. The
-- nullable pointTypeId rows cannot issue through the wallet API, so only
-- valid point-type rules are migrated.
INSERT INTO "Campaign" (
  "programId",
  "pointTypeId",
  "eventType",
  "name",
  "description",
  "type",
  "conditions",
  "multiplier",
  "isActive",
  "startsAt",
  "endsAt",
  "createdAt",
  "updatedAt"
)
SELECT
  pr."programId",
  pr."pointTypeId",
  pr."eventType",
  'Automatic issuance: ' || pr."eventType" || ' #' || pr."id",
  'Migrated from the legacy issuance rule.',
  'BONUS_POINTS'::"CampaignType",
  pr."conditions",
  pr."multiplier",
  pr."isActive",
  pr."startsAt",
  pr."endsAt",
  pr."createdAt",
  pr."updatedAt"
FROM "PointRule" pr
WHERE pr."pointTypeId" IS NOT NULL;

UPDATE "PointRule" SET "isActive" = false WHERE "isActive" = true;
