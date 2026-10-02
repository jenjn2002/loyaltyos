ALTER TABLE "Member"
  ADD COLUMN "lastWorkingDay" DATE,
  ADD COLUMN "offboardingReason" TEXT;

CREATE INDEX "Member_programId_status_lastWorkingDay_idx"
  ON "Member"("programId", "status", "lastWorkingDay");

ALTER TABLE "CustomPointTransaction"
  ADD COLUMN "balanceBefore" INTEGER,
  ADD COLUMN "hashVersion" INTEGER NOT NULL DEFAULT 1;

UPDATE "CustomPointTransaction"
SET "balanceBefore" = "balanceAfter" - "amount"
WHERE "balanceBefore" IS NULL;

ALTER TABLE "PointBankTransaction"
  ADD COLUMN "previousHash" TEXT,
  ADD COLUMN "recordHash" TEXT,
  ADD COLUMN "hashVersion" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "PointBankTransaction_recordHash_idx"
  ON "PointBankTransaction"("recordHash");

ALTER TABLE "AuditLog"
  ADD COLUMN "previousHash" TEXT,
  ADD COLUMN "recordHash" TEXT,
  ADD COLUMN "hashVersion" INTEGER NOT NULL DEFAULT 1;

-- P-credit uses one expiry date anchored to point-type creation. Existing
-- point lots keep their already-recorded expiresAt values.
UPDATE "PointTypeDefinition"
SET "expiryMode" = 'AFTER_DAYS',
    "expiryDays" = COALESCE("expiryDays", 365),
    "fixedExpiryAt" = NULL
WHERE upper("code") = 'P'
  AND "expiryMode" = 'PER_GRANT';

CREATE OR REPLACE FUNCTION loyaltyos_reject_immutable_record_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'This record is append-only and cannot be changed'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "AuditLog_append_only"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION loyaltyos_reject_immutable_record_change();

CREATE TRIGGER "CustomPointTransaction_append_only"
BEFORE UPDATE OR DELETE ON "CustomPointTransaction"
FOR EACH ROW EXECUTE FUNCTION loyaltyos_reject_immutable_record_change();

CREATE TRIGGER "PointBankTransaction_append_only"
BEFORE UPDATE OR DELETE ON "PointBankTransaction"
FOR EACH ROW EXECUTE FUNCTION loyaltyos_reject_immutable_record_change();
