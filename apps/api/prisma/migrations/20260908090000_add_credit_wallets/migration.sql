-- Dual Credit & Recognition wallets (P-credit and R-credit).
-- Existing PointAccount/PointTransaction data is intentionally preserved.

ALTER TABLE "Program" ADD COLUMN "creditGivingLimit" INTEGER;
ALTER TABLE "Program" ADD COLUMN "creditGivingPeriodDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "Program" ADD COLUMN "creditGivingPairLimit" INTEGER;

CREATE TYPE "CreditType" AS ENUM ('P', 'R');
CREATE TYPE "CreditTransactionType" AS ENUM (
  'GRANT',
  'GIVE_OUT',
  'GIVE_IN',
  'REDEEM',
  'EXCHANGE',
  'ADJUSTMENT',
  'EXPIRATION',
  'REVERSAL'
);

CREATE TABLE "CreditWallet" (
  "id" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "creditType" "CreditType" NOT NULL,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "totalGranted" INTEGER NOT NULL DEFAULT 0,
  "totalSpent" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditWallet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditExchangeRate" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "creditType" "CreditType" NOT NULL,
  "version" INTEGER NOT NULL,
  "valueMinorPerCredit" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "payoutMechanism" TEXT NOT NULL,
  "cashEligible" BOOLEAN NOT NULL DEFAULT false,
  "minCredits" INTEGER NOT NULL DEFAULT 1,
  "maxCredits" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditExchangeRate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditTransaction" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "creditType" "CreditType" NOT NULL,
  "type" "CreditTransactionType" NOT NULL,
  "amount" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "reason" TEXT,
  "message" TEXT,
  "category" TEXT,
  "counterpartyMemberId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "exchangeRateId" TEXT,
  "metadata" JSONB DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditBank" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "creditType" "CreditType" NOT NULL,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditBank_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditBankTransaction" (
  "id" TEXT NOT NULL,
  "bankId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "creditType" "CreditType" NOT NULL,
  "amount" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditBankTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditWallet_memberId_creditType_key" ON "CreditWallet"("memberId", "creditType");
CREATE INDEX "CreditWallet_programId_creditType_idx" ON "CreditWallet"("programId", "creditType");
CREATE INDEX "CreditWallet_memberId_programId_idx" ON "CreditWallet"("memberId", "programId");

CREATE UNIQUE INDEX "CreditExchangeRate_programId_creditType_version_key" ON "CreditExchangeRate"("programId", "creditType", "version");
CREATE INDEX "CreditExchangeRate_programId_creditType_isActive_idx" ON "CreditExchangeRate"("programId", "creditType", "isActive");

CREATE UNIQUE INDEX "CreditTransaction_idempotencyKey_key" ON "CreditTransaction"("idempotencyKey");
CREATE INDEX "CreditTransaction_memberId_createdAt_idx" ON "CreditTransaction"("memberId", "createdAt");
CREATE INDEX "CreditTransaction_programId_creditType_createdAt_idx" ON "CreditTransaction"("programId", "creditType", "createdAt");
CREATE INDEX "CreditTransaction_walletId_createdAt_idx" ON "CreditTransaction"("walletId", "createdAt");
CREATE INDEX "CreditTransaction_type_idx" ON "CreditTransaction"("type");
CREATE INDEX "CreditTransaction_expiresAt_idx" ON "CreditTransaction"("expiresAt");

CREATE UNIQUE INDEX "CreditBank_programId_creditType_key" ON "CreditBank"("programId", "creditType");
CREATE INDEX "CreditBank_programId_idx" ON "CreditBank"("programId");

CREATE UNIQUE INDEX "CreditBankTransaction_idempotencyKey_key" ON "CreditBankTransaction"("idempotencyKey");
CREATE INDEX "CreditBankTransaction_programId_creditType_createdAt_idx" ON "CreditBankTransaction"("programId", "creditType", "createdAt");

ALTER TABLE "CreditWallet" ADD CONSTRAINT "CreditWallet_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditWallet" ADD CONSTRAINT "CreditWallet_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditExchangeRate" ADD CONSTRAINT "CreditExchangeRate_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CreditWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_counterpartyMemberId_fkey" FOREIGN KEY ("counterpartyMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_exchangeRateId_fkey" FOREIGN KEY ("exchangeRateId") REFERENCES "CreditExchangeRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditBank" ADD CONSTRAINT "CreditBank_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditBankTransaction" ADD CONSTRAINT "CreditBankTransaction_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "CreditBank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditBankTransaction" ADD CONSTRAINT "CreditBankTransaction_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
