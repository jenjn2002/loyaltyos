-- Campaign approval belongs to the campaign policy. Event definitions only
-- describe how an occurrence is produced.
ALTER TABLE "Campaign"
  ADD COLUMN "issuancePolicy" TEXT NOT NULL DEFAULT 'STANDING';

-- Preserve the approval state of existing exceptional campaigns and make
-- external/one-time campaigns require approval going forward.
UPDATE "Campaign" c
SET "issuancePolicy" = CASE
  WHEN c."eventType" IS NULL OR lower(c."eventType") = 'purchase' THEN 'STANDING'
  WHEN e."automation"->>'mode' IN ('ONBOARDING', 'ANNIVERSARY', 'MEMBER_DATE_ANNUAL', 'ANNUAL_DATE') THEN 'STANDING'
  ELSE 'APPROVAL_REQUIRED'
END
FROM "EventDefinition" e
WHERE c."programId" = e."programId" AND lower(c."eventType") = e."key";

UPDATE "Campaign" c
SET "issuancePolicy" = 'APPROVAL_REQUIRED'
WHERE c."eventType" IS NOT NULL
  AND lower(c."eventType") <> 'purchase'
  AND NOT EXISTS (
    SELECT 1 FROM "EventDefinition" e
    WHERE e."programId" = c."programId" AND e."key" = lower(c."eventType")
  );

UPDATE "Campaign"
SET "approvalStatus" = 'DRAFT', "isActive" = false
WHERE "issuancePolicy" = 'APPROVAL_REQUIRED'
  AND "approvalStatus" = 'NOT_REQUIRED';

-- Existing built-in personal-date definitions become real scheduled events.
-- The date fields are optional so existing members without those values are
-- simply skipped by the scheduler until an administrator imports them.
INSERT INTO "MemberFieldDefinition" (
  "id", "programId", "key", "label", "type", "required", "options", "sortOrder", "createdAt", "updatedAt"
)
SELECT
  'field_' || lower(replace(p."id", '-', '')) || '_birth_date',
  p."id", 'birth_date', 'Birth date', 'DATE'::"MemberFieldType", false, '[]', 900,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Program" p
ON CONFLICT ("programId", "key") DO NOTHING;

INSERT INTO "MemberFieldDefinition" (
  "id", "programId", "key", "label", "type", "required", "options", "sortOrder", "createdAt", "updatedAt"
)
SELECT
  'field_' || lower(replace(p."id", '-', '')) || '_work_anniversary_date',
  p."id", 'work_anniversary_date', 'Work anniversary date', 'DATE'::"MemberFieldType", false, '[]', 901,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Program" p
ON CONFLICT ("programId", "key") DO NOTHING;

UPDATE "EventDefinition"
SET "automation" = '{"mode":"ONBOARDING","timezone":"Asia/Ho_Chi_Minh","dateField":"joinedAt","offsetDays":0}'::jsonb,
    "requiresApproval" = false
WHERE "key" = 'registration';

UPDATE "EventDefinition"
SET "automation" = '{"mode":"MEMBER_DATE_ANNUAL","timezone":"Asia/Ho_Chi_Minh","dateField":"metadata.birth_date","leapDayPolicy":"ONLY_LEAP_YEAR"}'::jsonb,
    "requiresApproval" = false
WHERE "key" = 'birthday';

UPDATE "EventDefinition"
SET "automation" = '{"mode":"MEMBER_DATE_ANNUAL","timezone":"Asia/Ho_Chi_Minh","dateField":"metadata.work_anniversary_date","leapDayPolicy":"ONLY_LEAP_YEAR"}'::jsonb,
    "requiresApproval" = false
WHERE "key" = 'work_anniversary';
