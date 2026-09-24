-- The current event-driven issuance path is Bonus Points. Normalize legacy
-- campaign-type records attached to an event so scheduled occasions can run.
UPDATE "Campaign"
SET "type" = 'BONUS_POINTS'::"CampaignType"
WHERE "eventType" IS NOT NULL
  AND lower("eventType") <> 'purchase'
  AND "type" <> 'BONUS_POINTS'::"CampaignType";

-- Built-in scheduled occasions were previously marked as external while the
-- scheduler configuration was introduced. Restore safe standing campaigns
-- that have no approval justification; intentional approval campaigns keep
-- their approval state and justification.
UPDATE "Campaign" c
SET "issuancePolicy" = 'STANDING',
    "approvalStatus" = 'NOT_REQUIRED',
    "isActive" = true
FROM "EventDefinition" e
WHERE c."programId" = e."programId"
  AND lower(c."eventType") = e."key"
  AND e."automation"->>'mode' IN ('ONBOARDING', 'MEMBER_DATE_ANNUAL', 'ANNIVERSARY', 'ANNUAL_DATE')
  AND c."justification" IS NULL
  AND c."approvalStatus" IN ('DRAFT', 'NOT_REQUIRED');

UPDATE "MemberFieldDefinition"
SET "label" = CASE "key"
  WHEN 'birth_date' THEN 'Ngày sinh'
  WHEN 'work_anniversary_date' THEN 'Ngày kỷ niệm làm việc'
  ELSE "label"
END
WHERE "key" IN ('birth_date', 'work_anniversary_date');
