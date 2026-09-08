-- Complete the Credit & Recognition rule-book domain model.
-- This migration is additive and preserves all existing point and credit data.

ALTER TABLE "Program" ADD COLUMN "creditBankCycleDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "Program" ADD COLUMN "creditExpiryWarningDays" INTEGER[] NOT NULL DEFAULT ARRAY[30, 7]::INTEGER[];

CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "CreditExchangeStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'CANCELLED', 'REJECTED');
CREATE TYPE "CreditBankCycleStatus" AS ENUM ('OPEN', 'CLOSED', 'CLEARED');
CREATE TYPE "CreditBulkStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');
CREATE TYPE "RewardFulfillmentStatus" AS ENUM ('PENDING', 'FULFILLED', 'CANCELLED');
ALTER TYPE "CreditTransactionType" ADD VALUE 'CLEARANCE';
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_GIVE';
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_REDEEM';
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_EXCHANGE';
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_ADJUSTMENT';
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_BULK';
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_BANK';
ALTER TYPE "AuditAction" ADD VALUE 'CREDIT_CLEARANCE';
ALTER TYPE "AuditActorType" ADD VALUE 'MEMBER';

ALTER TABLE "Member"
  ADD COLUMN "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN "department" TEXT,
  ADD COLUMN "photoUrl" TEXT;

ALTER TABLE "CreditTransaction"
  ADD COLUMN "categoryId" TEXT,
  ADD COLUMN "sourceCreditType" "CreditType",
  ADD COLUMN "receivedCreditType" "CreditType",
  ADD COLUMN "exchangeRequestId" TEXT,
  ADD COLUMN "actorType" TEXT,
  ADD COLUMN "actorId" TEXT,
  ADD COLUMN "previousHash" TEXT,
  ADD COLUMN "recordHash" TEXT;

ALTER TABLE "CreditBankTransaction" ADD COLUMN "cycleId" TEXT;

CREATE TABLE "CreditLot" (
  "id" TEXT NOT NULL,
  "grantTransactionId" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "creditType" "CreditType" NOT NULL,
  "originalAmount" INTEGER NOT NULL,
  "remainingAmount" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "warningDaysSent" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditLot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditCategory" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditBankCycle" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "status" "CreditBankCycleStatus" NOT NULL DEFAULT 'OPEN',
  "openingP" INTEGER NOT NULL DEFAULT 0,
  "openingR" INTEGER NOT NULL DEFAULT 0,
  "allocatedP" INTEGER NOT NULL DEFAULT 0,
  "allocatedR" INTEGER NOT NULL DEFAULT 0,
  "closingP" INTEGER NOT NULL DEFAULT 0,
  "closingR" INTEGER NOT NULL DEFAULT 0,
  "clearedAt" TIMESTAMP(3),
  "clearedBy" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditBankCycle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditExchangeRequest" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "creditType" "CreditType" NOT NULL,
  "amount" INTEGER NOT NULL,
  "valueMinor" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "payoutMechanism" TEXT NOT NULL,
  "payoutType" TEXT NOT NULL,
  "status" "CreditExchangeStatus" NOT NULL DEFAULT 'PENDING',
  "exchangeRateId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "approvedBy" TEXT,
  "fulfilledAt" TIMESTAMP(3),
  "fulfilledBy" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancelledBy" TEXT,
  "cancellationReason" TEXT,
  "metadata" JSONB DEFAULT '{}',
  CONSTRAINT "CreditExchangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditBulkBatch" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "status" "CreditBulkStatus" NOT NULL DEFAULT 'PROCESSING',
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "successRows" INTEGER NOT NULL DEFAULT 0,
  "failedRows" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "sourceName" TEXT,
  "report" JSONB DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "CreditBulkBatch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RewardRedemption"
  ADD COLUMN "fulfillmentStatus" "RewardFulfillmentStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "fulfilledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "CreditTransaction_exchangeRequestId_key" ON "CreditTransaction"("exchangeRequestId");
CREATE INDEX "CreditTransaction_categoryId_idx" ON "CreditTransaction"("categoryId");
CREATE INDEX "CreditTransaction_sourceCreditType_idx" ON "CreditTransaction"("sourceCreditType");
CREATE INDEX "CreditTransaction_receivedCreditType_idx" ON "CreditTransaction"("receivedCreditType");
CREATE INDEX "CreditTransaction_recordHash_idx" ON "CreditTransaction"("recordHash");
CREATE UNIQUE INDEX "CreditLot_grantTransactionId_key" ON "CreditLot"("grantTransactionId");
CREATE INDEX "CreditLot_walletId_remainingAmount_expiresAt_idx" ON "CreditLot"("walletId", "remainingAmount", "expiresAt");
CREATE INDEX "CreditLot_memberId_creditType_expiresAt_idx" ON "CreditLot"("memberId", "creditType", "expiresAt");

CREATE UNIQUE INDEX "CreditCategory_programId_name_key" ON "CreditCategory"("programId", "name");
CREATE INDEX "CreditCategory_programId_isActive_idx" ON "CreditCategory"("programId", "isActive");

CREATE INDEX "CreditBankCycle_programId_status_idx" ON "CreditBankCycle"("programId", "status");
CREATE INDEX "CreditBankCycle_programId_startsAt_endsAt_idx" ON "CreditBankCycle"("programId", "startsAt", "endsAt");

CREATE UNIQUE INDEX "CreditExchangeRequest_idempotencyKey_key" ON "CreditExchangeRequest"("idempotencyKey");
CREATE INDEX "CreditExchangeRequest_programId_status_requestedAt_idx" ON "CreditExchangeRequest"("programId", "status", "requestedAt");
CREATE INDEX "CreditExchangeRequest_memberId_requestedAt_idx" ON "CreditExchangeRequest"("memberId", "requestedAt");

CREATE INDEX "CreditBulkBatch_programId_createdAt_idx" ON "CreditBulkBatch"("programId", "createdAt");
CREATE INDEX "CreditBulkBatch_programId_status_idx" ON "CreditBulkBatch"("programId", "status");
CREATE INDEX "RewardRedemption_fulfillmentStatus_idx" ON "RewardRedemption"("fulfillmentStatus");

ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "CreditCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_exchangeRequestId_fkey"
  FOREIGN KEY ("exchangeRequestId") REFERENCES "CreditExchangeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditLot" ADD CONSTRAINT "CreditLot_grantTransactionId_fkey"
  FOREIGN KEY ("grantTransactionId") REFERENCES "CreditTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditLot" ADD CONSTRAINT "CreditLot_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "CreditWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditLot" ADD CONSTRAINT "CreditLot_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditLot" ADD CONSTRAINT "CreditLot_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditBankTransaction" ADD CONSTRAINT "CreditBankTransaction_cycleId_fkey"
  FOREIGN KEY ("cycleId") REFERENCES "CreditBankCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditCategory" ADD CONSTRAINT "CreditCategory_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditBankCycle" ADD CONSTRAINT "CreditBankCycle_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditExchangeRequest" ADD CONSTRAINT "CreditExchangeRequest_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditExchangeRequest" ADD CONSTRAINT "CreditExchangeRequest_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditExchangeRequest" ADD CONSTRAINT "CreditExchangeRequest_exchangeRateId_fkey"
  FOREIGN KEY ("exchangeRateId") REFERENCES "CreditExchangeRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
