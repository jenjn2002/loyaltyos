-- Existing campaigns using exceptional or unknown event keys must be reviewed
-- before they can continue issuing points.
UPDATE "Campaign" c
SET "approvalStatus" = 'DRAFT', "isActive" = false
WHERE c."eventType" IS NOT NULL
  AND c."approvalStatus" = 'NOT_REQUIRED'
  AND (
    NOT EXISTS (
      SELECT 1 FROM "EventDefinition" e
      WHERE e."programId" = c."programId" AND e."key" = lower(c."eventType")
    )
    OR EXISTS (
      SELECT 1 FROM "EventDefinition" e
      WHERE e."programId" = c."programId" AND e."key" = lower(c."eventType") AND e."requiresApproval" = true
    )
  );
