-- Exchange requests are accounting vouchers, not automatic payout jobs.
-- Preserve historical PAID rows while standardizing the terminal state as COMPLETED.
ALTER TYPE "CreditExchangeStatus" RENAME VALUE 'PAID' TO 'COMPLETED';

CREATE TYPE "PointExchangeStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED'
);

ALTER TABLE "PointExchangeRequest"
  DROP CONSTRAINT "PointExchangeRequest_status_check";

ALTER TABLE "PointExchangeRequest"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "PointExchangeStatus"
    USING (
      CASE
        WHEN "status" = 'PAID' THEN 'COMPLETED'
        ELSE "status"
      END
    )::"PointExchangeStatus",
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

ALTER TABLE "PointExchangeRequest"
  RENAME COLUMN "fulfilledAt" TO "completedAt";

ALTER TABLE "PointExchangeRequest"
  RENAME COLUMN "fulfilledBy" TO "completedBy";

ALTER TABLE "PointExchangeRequest"
  ADD COLUMN "documentNumber" TEXT,
  ADD COLUMN "approvalNote" TEXT,
  ADD COLUMN "completionReference" TEXT,
  ADD COLUMN "completionNote" TEXT;

UPDATE "PointExchangeRequest"
SET "documentNumber" =
  'EXC-' ||
  to_char("requestedAt", 'YYYYMMDD') ||
  '-' ||
  upper(substr(md5("programId" || ':' || "id"), 1, 16));

ALTER TABLE "PointExchangeRequest"
  ALTER COLUMN "documentNumber" SET NOT NULL;

CREATE UNIQUE INDEX "PointExchangeRequest_programId_documentNumber_key"
  ON "PointExchangeRequest"("programId", "documentNumber");
