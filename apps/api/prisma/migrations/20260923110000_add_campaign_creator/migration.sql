ALTER TABLE "Campaign" ADD COLUMN "createdById" TEXT;

-- Preserve the creator for campaigns that were created through the Admin API
-- before the relation was added. The create route already writes a campaign
-- configuration audit record for each such campaign.
UPDATE "Campaign" AS campaign
SET "createdById" = (
  SELECT audit."adminUserId"
  FROM "AuditLog" AS audit
  WHERE audit."programId" = campaign."programId"
    AND audit."entityType" = 'campaign'
    AND audit."entityId" = campaign."id"
    AND audit."actorType" = 'ADMIN_USER'
    AND audit."adminUserId" IS NOT NULL
  ORDER BY audit."createdAt" ASC
  LIMIT 1
)
WHERE campaign."createdById" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "AuditLog" AS audit
    WHERE audit."programId" = campaign."programId"
      AND audit."entityType" = 'campaign'
      AND audit."entityId" = campaign."id"
      AND audit."actorType" = 'ADMIN_USER'
      AND audit."adminUserId" IS NOT NULL
  );

CREATE INDEX "Campaign_createdById_idx" ON "Campaign"("createdById");

ALTER TABLE "Campaign"
  ADD CONSTRAINT "Campaign_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
