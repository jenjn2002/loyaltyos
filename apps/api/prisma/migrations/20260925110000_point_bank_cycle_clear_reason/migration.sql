ALTER TABLE "PointBankCycle"
ADD COLUMN "clearReason" TEXT;

UPDATE "PointBankCycle"
SET "clearReason" = "note",
    "note" = NULL
WHERE "status" = 'CLEARED'
  AND "note" IS NOT NULL;
