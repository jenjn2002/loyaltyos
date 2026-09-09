-- Unify every loyalty currency behind PointTypeDefinition + CustomPoint*.
-- The former P/R and legacy ledgers remain intact as read-only rollback sources.

ALTER TABLE "PointTypeDefinition"
  ADD COLUMN "icon" TEXT,
  ADD COLUMN "fixedExpiryAt" TIMESTAMP(3),
  ADD COLUMN "expiryWarningDays" INTEGER[] NOT NULL DEFAULT ARRAY[30, 7]::INTEGER[],
  ADD COLUMN "bankEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "giveEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "giveSource" TEXT NOT NULL DEFAULT 'BALANCE',
  ADD COLUMN "allowanceAmount" INTEGER,
  ADD COLUMN "allowanceCycleDays" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "allowanceCarryOver" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pairLimit" INTEGER,
  ADD COLUMN "pairLimitPeriodDays" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "requireGiveMessage" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allowMultiRecipient" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "maxRecipients" INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN "showOnMemberProfile" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "showZeroBalance" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "PointTypeDefinition"
  ADD CONSTRAINT "PointTypeDefinition_expiryMode_check"
    CHECK ("expiryMode" IN ('NEVER', 'AFTER_DAYS', 'FIXED_DATE', 'PER_GRANT')),
  ADD CONSTRAINT "PointTypeDefinition_giveSource_check"
    CHECK ("giveSource" IN ('BALANCE', 'ALLOWANCE', 'BOTH')),
  ADD CONSTRAINT "PointTypeDefinition_positive_config_check"
    CHECK (
      ("expiryDays" IS NULL OR "expiryDays" > 0)
      AND ("allowanceAmount" IS NULL OR "allowanceAmount" >= 0)
      AND "allowanceCycleDays" > 0
      AND ("pairLimit" IS NULL OR "pairLimit" > 0)
      AND "pairLimitPeriodDays" > 0
      AND "maxRecipients" > 0
    );

CREATE UNIQUE INDEX "PointTypeDefinition_one_primary_per_program"
  ON "PointTypeDefinition"("programId")
  WHERE "isPrimary" = true AND "archivedAt" IS NULL;
CREATE INDEX "PointTypeDefinition_programId_archivedAt_sortOrder_idx"
  ON "PointTypeDefinition"("programId", "archivedAt", "sortOrder");

ALTER TABLE "CustomPointTransaction"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "message" TEXT,
  ADD COLUMN "category" TEXT,
  ADD COLUMN "categoryId" TEXT,
  ADD COLUMN "counterpartyMemberId" TEXT,
  ADD COLUMN "sourcePointTypeId" TEXT,
  ADD COLUMN "destinationPointTypeId" TEXT,
  ADD COLUMN "exchangeRateId" TEXT,
  ADD COLUMN "exchangeRequestId" TEXT,
  ADD COLUMN "previousHash" TEXT,
  ADD COLUMN "recordHash" TEXT,
  ADD COLUMN "reversedFromId" TEXT,
  ADD COLUMN "reversedById" TEXT;

ALTER TABLE "CustomPointLot"
  ADD COLUMN "warningDaysSent" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

DROP INDEX "CustomPointLot_grantTransactionId_key";
CREATE INDEX "CustomPointLot_grantTransactionId_idx"
  ON "CustomPointLot"("grantTransactionId");

CREATE UNIQUE INDEX "CustomPointTransaction_exchangeRequestId_key"
  ON "CustomPointTransaction"("exchangeRequestId");
DROP INDEX "CustomPointTransaction_idempotencyKey_key";
CREATE UNIQUE INDEX "CustomPointTransaction_programId_idempotencyKey_key"
  ON "CustomPointTransaction"("programId", "idempotencyKey");

DROP INDEX "Event_idempotencyKey_key";
DROP INDEX "Event_idempotencyKey_idx";
CREATE UNIQUE INDEX "Event_programId_idempotencyKey_key"
  ON "Event"("programId", "idempotencyKey");
CREATE INDEX "CustomPointTransaction_categoryId_idx"
  ON "CustomPointTransaction"("categoryId");
CREATE INDEX "CustomPointTransaction_counterpartyMemberId_idx"
  ON "CustomPointTransaction"("counterpartyMemberId");
CREATE INDEX "CustomPointTransaction_recordHash_idx"
  ON "CustomPointTransaction"("recordHash");

ALTER TABLE "CustomPointTransaction"
  ADD CONSTRAINT "CustomPointTransaction_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "CreditCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomPointTransaction_counterpartyMemberId_fkey"
    FOREIGN KEY ("counterpartyMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomPointTransaction_sourcePointTypeId_fkey"
    FOREIGN KEY ("sourcePointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomPointTransaction_destinationPointTypeId_fkey"
    FOREIGN KEY ("destinationPointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PointTransferRule" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "sourcePointTypeId" TEXT NOT NULL,
  "destinationPointTypeId" TEXT NOT NULL,
  "sourceAmount" INTEGER NOT NULL DEFAULT 1,
  "destinationAmount" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PointTransferRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PointTransferRule_ratio_check" CHECK ("sourceAmount" > 0 AND "destinationAmount" > 0)
);

CREATE UNIQUE INDEX "PointTransferRule_sourcePointTypeId_destinationPointTypeId_key"
  ON "PointTransferRule"("sourcePointTypeId", "destinationPointTypeId");
CREATE INDEX "PointTransferRule_programId_isActive_idx"
  ON "PointTransferRule"("programId", "isActive");
ALTER TABLE "PointTransferRule"
  ADD CONSTRAINT "PointTransferRule_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PointTransferRule_sourcePointTypeId_fkey"
    FOREIGN KEY ("sourcePointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PointTransferRule_destinationPointTypeId_fkey"
    FOREIGN KEY ("destinationPointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PointAllowance" (
  "id" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "pointTypeId" TEXT NOT NULL,
  "cycleStart" TIMESTAMP(3) NOT NULL,
  "cycleEnd" TIMESTAMP(3) NOT NULL,
  "allocated" INTEGER NOT NULL,
  "remaining" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PointAllowance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PointAllowance_values_check"
    CHECK ("allocated" >= 0 AND "remaining" >= 0 AND "cycleEnd" > "cycleStart")
);

CREATE UNIQUE INDEX "PointAllowance_memberId_pointTypeId_cycleStart_key"
  ON "PointAllowance"("memberId", "pointTypeId", "cycleStart");
CREATE INDEX "PointAllowance_programId_pointTypeId_cycleEnd_idx"
  ON "PointAllowance"("programId", "pointTypeId", "cycleEnd");
ALTER TABLE "PointAllowance"
  ADD CONSTRAINT "PointAllowance_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PointAllowance_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PointAllowance_pointTypeId_fkey"
    FOREIGN KEY ("pointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PointBank" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "pointTypeId" TEXT NOT NULL,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PointBank_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PointBank_balance_check" CHECK ("balance" >= 0)
);

CREATE UNIQUE INDEX "PointBank_programId_pointTypeId_key"
  ON "PointBank"("programId", "pointTypeId");
CREATE INDEX "PointBank_programId_idx" ON "PointBank"("programId");
ALTER TABLE "PointBank"
  ADD CONSTRAINT "PointBank_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PointBank_pointTypeId_fkey"
    FOREIGN KEY ("pointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PointBankCycle" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "pointTypeId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "opening" INTEGER NOT NULL DEFAULT 0,
  "allocated" INTEGER NOT NULL DEFAULT 0,
  "closing" INTEGER NOT NULL DEFAULT 0,
  "clearedAt" TIMESTAMP(3),
  "clearedBy" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PointBankCycle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PointBankCycle_status_check" CHECK ("status" IN ('OPEN', 'CLOSED', 'CLEARED')),
  CONSTRAINT "PointBankCycle_dates_check" CHECK ("endsAt" > "startsAt")
);

CREATE INDEX "PointBankCycle_programId_pointTypeId_status_idx"
  ON "PointBankCycle"("programId", "pointTypeId", "status");
CREATE INDEX "PointBankCycle_programId_startsAt_endsAt_idx"
  ON "PointBankCycle"("programId", "startsAt", "endsAt");
ALTER TABLE "PointBankCycle"
  ADD CONSTRAINT "PointBankCycle_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PointBankCycle_pointTypeId_fkey"
    FOREIGN KEY ("pointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PointBankTransaction" (
  "id" TEXT NOT NULL,
  "bankId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "pointTypeId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "cycleId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PointBankTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PointBankTransaction_programId_idempotencyKey_key"
  ON "PointBankTransaction"("programId", "idempotencyKey");
CREATE INDEX "PointBankTransaction_programId_pointTypeId_createdAt_idx"
  ON "PointBankTransaction"("programId", "pointTypeId", "createdAt");
ALTER TABLE "PointBankTransaction"
  ADD CONSTRAINT "PointBankTransaction_bankId_fkey"
    FOREIGN KEY ("bankId") REFERENCES "PointBank"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PointBankTransaction_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PointBankTransaction_pointTypeId_fkey"
    FOREIGN KEY ("pointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PointBankTransaction_cycleId_fkey"
    FOREIGN KEY ("cycleId") REFERENCES "PointBankCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PointExchangeRate" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "pointTypeId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "valueMinorPerPoint" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "payoutMechanism" TEXT NOT NULL,
  "payoutType" TEXT NOT NULL DEFAULT 'NON_CASH',
  "minPoints" INTEGER NOT NULL DEFAULT 1,
  "maxPoints" INTEGER,
  "periodLimitPoints" INTEGER,
  "periodDays" INTEGER NOT NULL DEFAULT 30,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PointExchangeRate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PointExchangeRate_values_check"
    CHECK (
      "valueMinorPerPoint" > 0
      AND "minPoints" > 0
      AND ("maxPoints" IS NULL OR "maxPoints" >= "minPoints")
      AND ("periodLimitPoints" IS NULL OR "periodLimitPoints" > 0)
      AND "periodDays" > 0
      AND "payoutType" IN ('CASH', 'NON_CASH')
    )
);

CREATE UNIQUE INDEX "PointExchangeRate_programId_pointTypeId_version_key"
  ON "PointExchangeRate"("programId", "pointTypeId", "version");
CREATE INDEX "PointExchangeRate_programId_pointTypeId_isActive_idx"
  ON "PointExchangeRate"("programId", "pointTypeId", "isActive");
ALTER TABLE "PointExchangeRate"
  ADD CONSTRAINT "PointExchangeRate_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PointExchangeRate_pointTypeId_fkey"
    FOREIGN KEY ("pointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PointExchangeRequest" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "pointTypeId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "valueMinor" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "payoutMechanism" TEXT NOT NULL,
  "payoutType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
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
  CONSTRAINT "PointExchangeRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PointExchangeRequest_status_check"
    CHECK ("status" IN ('PENDING', 'APPROVED', 'PAID', 'CANCELLED', 'REJECTED')),
  CONSTRAINT "PointExchangeRequest_values_check" CHECK ("amount" > 0 AND "valueMinor" > 0)
);

CREATE UNIQUE INDEX "PointExchangeRequest_programId_idempotencyKey_key"
  ON "PointExchangeRequest"("programId", "idempotencyKey");
CREATE INDEX "PointExchangeRequest_programId_status_requestedAt_idx"
  ON "PointExchangeRequest"("programId", "status", "requestedAt");
CREATE INDEX "PointExchangeRequest_memberId_requestedAt_idx"
  ON "PointExchangeRequest"("memberId", "requestedAt");
ALTER TABLE "PointExchangeRequest"
  ADD CONSTRAINT "PointExchangeRequest_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PointExchangeRequest_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PointExchangeRequest_pointTypeId_fkey"
    FOREIGN KEY ("pointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PointExchangeRequest_exchangeRateId_fkey"
    FOREIGN KEY ("exchangeRateId") REFERENCES "PointExchangeRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomPointTransaction"
  ADD CONSTRAINT "CustomPointTransaction_exchangeRateId_fkey"
    FOREIGN KEY ("exchangeRateId") REFERENCES "PointExchangeRate"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomPointTransaction_exchangeRequestId_fkey"
    FOREIGN KEY ("exchangeRequestId") REFERENCES "PointExchangeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "RewardPointPrice" (
  "id" TEXT NOT NULL,
  "rewardId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "pointTypeId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RewardPointPrice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardPointPrice_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "RewardPointPrice_rewardId_pointTypeId_key"
  ON "RewardPointPrice"("rewardId", "pointTypeId");
CREATE INDEX "RewardPointPrice_programId_pointTypeId_idx"
  ON "RewardPointPrice"("programId", "pointTypeId");
ALTER TABLE "RewardPointPrice"
  ADD CONSTRAINT "RewardPointPrice_rewardId_fkey"
    FOREIGN KEY ("rewardId") REFERENCES "Reward"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RewardPointPrice_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RewardPointPrice_pointTypeId_fkey"
    FOREIGN KEY ("pointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Reward"
  ADD COLUMN "availableFrom" TIMESTAMP(3),
  ADD COLUMN "availableUntil" TIMESTAMP(3);
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_availability_check"
  CHECK ("availableUntil" IS NULL OR "availableFrom" IS NULL OR "availableUntil" > "availableFrom");

ALTER TABLE "RewardRedemption"
  ADD COLUMN "pointTypeId" TEXT,
  ADD COLUMN "pointTransactionId" TEXT;
CREATE UNIQUE INDEX "RewardRedemption_pointTransactionId_key"
  ON "RewardRedemption"("pointTransactionId");
ALTER TABLE "RewardRedemption"
  ADD CONSTRAINT "RewardRedemption_pointTypeId_fkey"
    FOREIGN KEY ("pointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PointRule" ADD COLUMN "pointTypeId" TEXT;
ALTER TABLE "PointRule" ADD CONSTRAINT "PointRule_pointTypeId_fkey"
  FOREIGN KEY ("pointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Tier" ADD COLUMN "pointTypeId" TEXT;
ALTER TABLE "Tier" ADD CONSTRAINT "Tier_pointTypeId_fkey"
  FOREIGN KEY ("pointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD COLUMN "pointTypeId" TEXT;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_pointTypeId_fkey"
  FOREIGN KEY ("pointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CampaignApplication" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "CampaignApplication_campaignId_idempotencyKey_key"
  ON "CampaignApplication"("campaignId", "idempotencyKey");

CREATE TABLE "AdminRolePermission" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "role" "AdminRole" NOT NULL,
  "capability" TEXT NOT NULL,
  "allowed" BOOLEAN NOT NULL DEFAULT false,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminRolePermission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminRolePermission_programId_role_capability_key"
  ON "AdminRolePermission"("programId", "role", "capability");
CREATE INDEX "AdminRolePermission_programId_role_idx"
  ON "AdminRolePermission"("programId", "role");
ALTER TABLE "AdminRolePermission"
  ADD CONSTRAINT "AdminRolePermission_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Upgrade existing programs to the former rule-book template once. New programs
-- start empty and can explicitly apply this same template from the admin UI.
INSERT INTO "PointTypeDefinition" (
  "id", "programId", "code", "name", "unitLabel", "description", "color",
  "expiryMode", "allowNegativeBalance", "allowManualAdjustment", "transferable",
  "redeemable", "exchangeable", "cashEligible", "bankEnabled", "giveEnabled",
  "giveSource", "requireGiveMessage", "allowMultiRecipient", "maxRecipients",
  "showOnMemberProfile", "showZeroBalance", "sortOrder", "isActive", "metadata",
  "createdAt", "updatedAt"
)
SELECT
  'pt_p_' || md5(p."id"), p."id", 'P', 'P-credit', 'P-credit',
  'Project credit. It can expire and may be exchanged for cash when a cash rate is configured.',
  '#2563eb', 'PER_GRANT', false, true, true, true, true, true, true, true,
  'BALANCE', true, true, 500, true, true, 10, true,
  '{"template":"credit-recognition-v1"}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Program" p
ON CONFLICT ("programId", "code") DO NOTHING;

INSERT INTO "PointTypeDefinition" (
  "id", "programId", "code", "name", "unitLabel", "description", "color",
  "expiryMode", "allowNegativeBalance", "allowManualAdjustment", "transferable",
  "redeemable", "exchangeable", "cashEligible", "bankEnabled", "giveEnabled",
  "giveSource", "allowanceAmount", "allowanceCycleDays", "pairLimit",
  "pairLimitPeriodDays", "requireGiveMessage", "allowMultiRecipient",
  "maxRecipients", "showOnMemberProfile", "showZeroBalance", "sortOrder",
  "isActive", "metadata", "createdAt", "updatedAt"
)
SELECT
  'pt_r_' || md5(p."id"), p."id", 'R', 'R-credit', 'R-credit',
  'Recognition credit. Owned balance never expires; Give can use owned balance or a renewable allowance.',
  '#7c3aed', 'NEVER', false, true, true, true, true, false, true, true,
  'BOTH', p."creditGivingLimit", p."creditGivingPeriodDays",
  p."creditGivingPairLimit", p."creditGivingPeriodDays", true, true, 500,
  true, true, 20, true, '{"template":"credit-recognition-v1"}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Program" p
ON CONFLICT ("programId", "code") DO NOTHING;

UPDATE "PointTypeDefinition" pt
SET
  "bankEnabled" = true,
  "giveEnabled" = true,
  "transferable" = true,
  "redeemable" = true,
  "exchangeable" = true,
  "cashEligible" = true,
  "giveSource" = 'BALANCE',
  "expiryMode" = CASE WHEN pt."expiryMode" = 'NEVER' THEN 'PER_GRANT' ELSE pt."expiryMode" END,
  "sortOrder" = CASE WHEN pt."sortOrder" = 0 THEN 10 ELSE pt."sortOrder" END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE pt."code" = 'P';

UPDATE "PointTypeDefinition" pt
SET
  "bankEnabled" = true,
  "giveEnabled" = true,
  "transferable" = true,
  "redeemable" = true,
  "exchangeable" = true,
  "cashEligible" = false,
  "giveSource" = 'BOTH',
  "allowanceAmount" = COALESCE(pt."allowanceAmount", p."creditGivingLimit"),
  "allowanceCycleDays" = p."creditGivingPeriodDays",
  "pairLimit" = COALESCE(pt."pairLimit", p."creditGivingPairLimit"),
  "pairLimitPeriodDays" = p."creditGivingPeriodDays",
  "expiryMode" = 'NEVER',
  "expiryDays" = NULL,
  "fixedExpiryAt" = NULL,
  "sortOrder" = CASE WHEN pt."sortOrder" = 0 THEN 20 ELSE pt."sortOrder" END,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Program" p
WHERE pt."programId" = p."id" AND pt."code" = 'R';

INSERT INTO "PointTransferRule" (
  "id", "programId", "sourcePointTypeId", "destinationPointTypeId",
  "sourceAmount", "destinationAmount", "isActive", "createdAt", "updatedAt"
)
SELECT
  'ptr_pr_' || md5(p."id"), p."id", source_type."id", destination_type."id",
  1, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Program" p
JOIN "PointTypeDefinition" source_type
  ON source_type."programId" = p."id" AND source_type."code" = 'P'
JOIN "PointTypeDefinition" destination_type
  ON destination_type."programId" = p."id" AND destination_type."code" = 'R'
ON CONFLICT ("sourcePointTypeId", "destinationPointTypeId") DO NOTHING;

INSERT INTO "PointTransferRule" (
  "id", "programId", "sourcePointTypeId", "destinationPointTypeId",
  "sourceAmount", "destinationAmount", "isActive", "createdAt", "updatedAt"
)
SELECT
  'ptr_rr_' || md5(p."id"), p."id", point_type."id", point_type."id",
  1, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Program" p
JOIN "PointTypeDefinition" point_type
  ON point_type."programId" = p."id" AND point_type."code" = 'R'
ON CONFLICT ("sourcePointTypeId", "destinationPointTypeId") DO NOTHING;

-- Preserve the original generic points ledger as a normal, configurable type.
INSERT INTO "PointTypeDefinition" (
  "id", "programId", "code", "name", "unitLabel", "description", "expiryMode",
  "allowNegativeBalance", "allowManualAdjustment", "transferable", "redeemable",
  "exchangeable", "cashEligible", "showOnMemberProfile", "showZeroBalance",
  "isPrimary", "sortOrder", "isActive", "metadata", "createdAt", "updatedAt"
)
SELECT DISTINCT
  'pt_legacy_' || md5(pa."programId"), pa."programId", 'LEGACY_POINTS',
  'Points', p."pointsUnit", 'Points migrated from the original LoyaltyOS ledger.',
  'NEVER', false, true, false, true, false, false, true, false,
  NOT EXISTS (
    SELECT 1 FROM "PointTypeDefinition" current_type
    WHERE current_type."programId" = pa."programId" AND current_type."isPrimary" = true
  ),
  100, true, '{"migratedFrom":"PointAccount"}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "PointAccount" pa
JOIN "Program" p ON p."id" = pa."programId"
ON CONFLICT ("programId", "code") DO NOTHING;

-- Every migrated program with point data gets one deterministic fallback.
-- LEGACY_POINTS stays primary when it exists; otherwise P becomes primary.
UPDATE "PointTypeDefinition" candidate
SET "isPrimary" = true, "updatedAt" = CURRENT_TIMESTAMP
WHERE candidate."code" = 'P'
  AND NOT EXISTS (
    SELECT 1 FROM "PointTypeDefinition" current_type
    WHERE current_type."programId" = candidate."programId"
      AND current_type."isPrimary" = true
      AND current_type."archivedAt" IS NULL
  );

-- Migrate P/R wallets and their ledger into the canonical wallet engine.
INSERT INTO "CustomPointWallet" (
  "id", "memberId", "programId", "pointTypeId", "balance",
  "totalEarned", "totalSpent", "createdAt", "updatedAt"
)
SELECT
  'pw_credit_' || md5(cw."id"), cw."memberId", cw."programId", pt."id",
  cw."balance", cw."totalGranted", cw."totalSpent", cw."createdAt", cw."updatedAt"
FROM "CreditWallet" cw
JOIN "PointTypeDefinition" pt
  ON pt."programId" = cw."programId" AND pt."code" = cw."creditType"::text
ON CONFLICT ("memberId", "pointTypeId") DO UPDATE
SET
  "balance" = "CustomPointWallet"."balance" + EXCLUDED."balance",
  "totalEarned" = "CustomPointWallet"."totalEarned" + EXCLUDED."totalEarned",
  "totalSpent" = "CustomPointWallet"."totalSpent" + EXCLUDED."totalSpent",
  "updatedAt" = GREATEST("CustomPointWallet"."updatedAt", EXCLUDED."updatedAt");

INSERT INTO "PointExchangeRate" (
  "id", "programId", "pointTypeId", "version", "valueMinorPerPoint",
  "currency", "payoutMechanism", "payoutType", "minPoints", "maxPoints",
  "isActive", "createdAt"
)
SELECT
  'per_credit_' || md5(rate."id"), rate."programId", pt."id", rate."version",
  rate."valueMinorPerCredit", rate."currency", rate."payoutMechanism",
  CASE WHEN rate."cashEligible" THEN 'CASH' ELSE 'NON_CASH' END,
  rate."minCredits", rate."maxCredits", rate."isActive", rate."createdAt"
FROM "CreditExchangeRate" rate
JOIN "PointTypeDefinition" pt
  ON pt."programId" = rate."programId" AND pt."code" = rate."creditType"::text
ON CONFLICT ("programId", "pointTypeId", "version") DO NOTHING;

INSERT INTO "PointExchangeRequest" (
  "id", "programId", "memberId", "pointTypeId", "amount", "valueMinor",
  "currency", "payoutMechanism", "payoutType", "status", "exchangeRateId",
  "idempotencyKey", "requestedAt", "approvedAt", "approvedBy", "fulfilledAt",
  "fulfilledBy", "cancelledAt", "cancelledBy", "cancellationReason", "metadata"
)
SELECT
  'pxr_credit_' || md5(req."id"), req."programId", req."memberId", pt."id",
  req."amount", req."valueMinor", req."currency", req."payoutMechanism",
  req."payoutType", req."status"::text, migrated_rate."id",
  'migrated-credit-exchange:' || req."idempotencyKey", req."requestedAt",
  req."approvedAt", req."approvedBy", req."fulfilledAt", req."fulfilledBy",
  req."cancelledAt", req."cancelledBy", req."cancellationReason",
  COALESCE(req."metadata", '{}'::jsonb) || jsonb_build_object('migratedFrom', 'CreditExchangeRequest', 'legacyId', req."id")
FROM "CreditExchangeRequest" req
JOIN "PointTypeDefinition" pt
  ON pt."programId" = req."programId" AND pt."code" = req."creditType"::text
JOIN "PointExchangeRate" migrated_rate
  ON migrated_rate."id" = 'per_credit_' || md5(req."exchangeRateId")
ON CONFLICT ("programId", "idempotencyKey") DO NOTHING;

INSERT INTO "CustomPointTransaction" (
  "id", "walletId", "memberId", "programId", "pointTypeId", "action",
  "amount", "balanceAfter", "source", "reason", "message", "category",
  "categoryId", "counterpartyMemberId", "sourcePointTypeId",
  "destinationPointTypeId", "exchangeRateId", "exchangeRequestId",
  "actorType", "actorId", "previousHash", "recordHash", "idempotencyKey",
  "expiresAt", "metadata", "createdAt"
)
SELECT
  'ptx_credit_' || md5(ct."id"), wallet."id", ct."memberId", ct."programId",
  point_type."id", ct."type"::text, ct."amount", ct."balanceAfter", ct."source",
  ct."reason", ct."message", ct."category", ct."categoryId",
  ct."counterpartyMemberId", source_type."id", destination_type."id",
  CASE WHEN ct."exchangeRateId" IS NULL THEN NULL ELSE 'per_credit_' || md5(ct."exchangeRateId") END,
  CASE WHEN ct."exchangeRequestId" IS NULL THEN NULL ELSE 'pxr_credit_' || md5(ct."exchangeRequestId") END,
  ct."actorType", ct."actorId", ct."previousHash", ct."recordHash",
  'migrated-credit:' || ct."idempotencyKey", ct."expiresAt",
  COALESCE(ct."metadata", '{}'::jsonb) || jsonb_build_object('migratedFrom', 'CreditTransaction', 'legacyId', ct."id"),
  ct."createdAt"
FROM "CreditTransaction" ct
JOIN "PointTypeDefinition" point_type
  ON point_type."programId" = ct."programId" AND point_type."code" = ct."creditType"::text
JOIN "CustomPointWallet" wallet
  ON wallet."memberId" = ct."memberId" AND wallet."pointTypeId" = point_type."id"
LEFT JOIN "PointTypeDefinition" source_type
  ON source_type."programId" = ct."programId" AND source_type."code" = ct."sourceCreditType"::text
LEFT JOIN "PointTypeDefinition" destination_type
  ON destination_type."programId" = ct."programId" AND destination_type."code" = ct."receivedCreditType"::text
ON CONFLICT ("programId", "idempotencyKey") DO NOTHING;

INSERT INTO "CustomPointLot" (
  "id", "walletId", "memberId", "programId", "pointTypeId",
  "grantTransactionId", "originalAmount", "remainingAmount", "expiresAt",
  "warningDaysSent", "createdAt"
)
SELECT
  'pl_credit_' || md5(lot."id"), wallet."id", lot."memberId", lot."programId",
  point_type."id", 'ptx_credit_' || md5(lot."grantTransactionId"),
  lot."originalAmount", lot."remainingAmount", lot."expiresAt",
  lot."warningDaysSent", lot."createdAt"
FROM "CreditLot" lot
JOIN "PointTypeDefinition" point_type
  ON point_type."programId" = lot."programId" AND point_type."code" = lot."creditType"::text
JOIN "CustomPointWallet" wallet
  ON wallet."memberId" = lot."memberId" AND wallet."pointTypeId" = point_type."id"
JOIN "CustomPointTransaction" migrated_transaction
  ON migrated_transaction."id" = 'ptx_credit_' || md5(lot."grantTransactionId")
ON CONFLICT ("id") DO NOTHING;

-- Migrate original PointAccount balances and history.
INSERT INTO "CustomPointWallet" (
  "id", "memberId", "programId", "pointTypeId", "balance",
  "totalEarned", "totalSpent", "createdAt", "updatedAt"
)
SELECT
  'pw_legacy_' || md5(pa."id"), pa."memberId", pa."programId", pt."id",
  pa."balance", pa."totalEarned", pa."totalRedeemed", pa."createdAt", pa."updatedAt"
FROM "PointAccount" pa
JOIN "PointTypeDefinition" pt
  ON pt."programId" = pa."programId" AND pt."code" = 'LEGACY_POINTS'
ON CONFLICT ("memberId", "pointTypeId") DO NOTHING;

INSERT INTO "CustomPointTransaction" (
  "id", "walletId", "memberId", "programId", "pointTypeId", "action",
  "amount", "balanceAfter", "source", "reason", "actorType", "actorId",
  "reversedFromId", "reversedById", "idempotencyKey", "expiresAt",
  "metadata", "createdAt"
)
SELECT
  'ptx_legacy_' || md5(tx."id"), wallet."id", account."memberId",
  account."programId", point_type."id",
  CASE tx."type"::text
    WHEN 'EXPIRE' THEN 'EXPIRATION'
    WHEN 'REVERSE' THEN 'REVERSAL'
    WHEN 'ADJUST' THEN 'ADJUSTMENT'
    ELSE tx."type"::text
  END,
  CASE
    WHEN tx."type"::text IN ('REDEEM', 'EXPIRE', 'CONVERT_OUT') THEN -ABS(tx."amount")
    WHEN tx."type"::text IN ('EARN', 'CONVERT_IN') THEN ABS(tx."amount")
    ELSE tx."amount"
  END,
  tx."balanceAfter", tx."source", tx."description", 'SYSTEM', 'legacy-migration',
  CASE WHEN tx."reversedFromId" IS NULL THEN NULL ELSE 'ptx_legacy_' || md5(tx."reversedFromId") END,
  CASE WHEN tx."reversedById" IS NULL THEN NULL ELSE 'ptx_legacy_' || md5(tx."reversedById") END,
  'migrated-legacy:' || tx."idempotencyKey", tx."expiresAt",
  COALESCE(tx."metadata", '{}'::jsonb) || jsonb_build_object('migratedFrom', 'PointTransaction', 'legacyId', tx."id"),
  tx."createdAt"
FROM "PointTransaction" tx
JOIN "PointAccount" account ON account."id" = tx."accountId"
JOIN "PointTypeDefinition" point_type
  ON point_type."programId" = account."programId" AND point_type."code" = 'LEGACY_POINTS'
JOIN "CustomPointWallet" wallet
  ON wallet."memberId" = account."memberId" AND wallet."pointTypeId" = point_type."id"
ON CONFLICT ("programId", "idempotencyKey") DO NOTHING;

-- Migrate bank state, cycles and history.
INSERT INTO "PointBank" (
  "id", "programId", "pointTypeId", "balance", "createdAt", "updatedAt"
)
SELECT
  'pb_credit_' || md5(bank."id"), bank."programId", pt."id", bank."balance",
  bank."createdAt", bank."updatedAt"
FROM "CreditBank" bank
JOIN "PointTypeDefinition" pt
  ON pt."programId" = bank."programId" AND pt."code" = bank."creditType"::text
ON CONFLICT ("programId", "pointTypeId") DO UPDATE
SET "balance" = "PointBank"."balance" + EXCLUDED."balance";

INSERT INTO "PointBankCycle" (
  "id", "programId", "pointTypeId", "startsAt", "endsAt", "status",
  "opening", "allocated", "closing", "clearedAt", "clearedBy", "note",
  "createdAt", "updatedAt"
)
SELECT
  'pbc_credit_' || md5(cycle."id" || ':' || type_code.code), cycle."programId",
  pt."id", cycle."startsAt", cycle."endsAt", cycle."status"::text,
  CASE WHEN type_code.code = 'P' THEN cycle."openingP" ELSE cycle."openingR" END,
  CASE WHEN type_code.code = 'P' THEN cycle."allocatedP" ELSE cycle."allocatedR" END,
  CASE WHEN type_code.code = 'P' THEN cycle."closingP" ELSE cycle."closingR" END,
  cycle."clearedAt", cycle."clearedBy", cycle."note", cycle."createdAt", cycle."updatedAt"
FROM "CreditBankCycle" cycle
CROSS JOIN (VALUES ('P'), ('R')) AS type_code(code)
JOIN "PointTypeDefinition" pt
  ON pt."programId" = cycle."programId" AND pt."code" = type_code.code;

INSERT INTO "PointBankTransaction" (
  "id", "bankId", "programId", "pointTypeId", "amount", "balanceAfter",
  "type", "reason", "actorId", "cycleId", "idempotencyKey", "createdAt"
)
SELECT
  'pbtx_credit_' || md5(tx."id"), bank."id", tx."programId", pt."id",
  tx."amount", tx."balanceAfter", tx."type", tx."reason", tx."actorId",
  CASE WHEN tx."cycleId" IS NULL THEN NULL
    ELSE 'pbc_credit_' || md5(tx."cycleId" || ':' || tx."creditType"::text)
  END,
  'migrated-credit-bank:' || tx."idempotencyKey", tx."createdAt"
FROM "CreditBankTransaction" tx
JOIN "PointTypeDefinition" pt
  ON pt."programId" = tx."programId" AND pt."code" = tx."creditType"::text
JOIN "PointBank" bank
  ON bank."programId" = tx."programId" AND bank."pointTypeId" = pt."id"
ON CONFLICT ("programId", "idempotencyKey") DO NOTHING;

-- Attach rules, campaigns and tiers to the migrated primary points type.
UPDATE "PointRule" target
SET "pointTypeId" = point_type."id"
FROM "PointTypeDefinition" point_type
WHERE point_type."programId" = target."programId"
  AND point_type."code" = 'LEGACY_POINTS'
  AND target."pointTypeId" IS NULL;

UPDATE "Campaign" target
SET "pointTypeId" = point_type."id"
FROM "PointTypeDefinition" point_type
WHERE point_type."programId" = target."programId"
  AND point_type."code" = 'LEGACY_POINTS'
  AND target."pointTypeId" IS NULL;

UPDATE "Tier" target
SET "pointTypeId" = point_type."id"
FROM "PointTypeDefinition" point_type
WHERE point_type."programId" = target."programId"
  AND point_type."code" = 'LEGACY_POINTS'
  AND target."pointTypeId" IS NULL;

-- Programs without a legacy PointAccount use their selected primary type.
UPDATE "PointRule" target
SET "pointTypeId" = point_type."id"
FROM "PointTypeDefinition" point_type
WHERE point_type."programId" = target."programId"
  AND point_type."isPrimary" = true
  AND target."pointTypeId" IS NULL;

UPDATE "Campaign" target
SET "pointTypeId" = point_type."id"
FROM "PointTypeDefinition" point_type
WHERE point_type."programId" = target."programId"
  AND point_type."isPrimary" = true
  AND target."pointTypeId" IS NULL;

UPDATE "Tier" target
SET "pointTypeId" = point_type."id"
FROM "PointTypeDefinition" point_type
WHERE point_type."programId" = target."programId"
  AND point_type."isPrimary" = true
  AND target."pointTypeId" IS NULL;

-- Existing rewards retain all previously supported payment choices; admins can
-- remove or alter each price independently after migration.
INSERT INTO "RewardPointPrice" (
  "id", "rewardId", "programId", "pointTypeId", "amount", "createdAt", "updatedAt"
)
SELECT
  'rpp_' || md5(reward."id" || ':' || point_type."id"), reward."id",
  reward."programId", point_type."id", reward."pointsCost",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Reward" reward
JOIN "PointTypeDefinition" point_type
  ON point_type."programId" = reward."programId"
  AND point_type."redeemable" = true
  AND point_type."archivedAt" IS NULL
ON CONFLICT ("rewardId", "pointTypeId") DO NOTHING;

UPDATE "RewardRedemption" redemption
SET "pointTypeId" = point_type."id"
FROM "Reward" reward, "PointTypeDefinition" point_type
WHERE redemption."rewardId" = reward."id"
  AND point_type."programId" = reward."programId"
  AND point_type."code" = COALESCE(redemption."metadata"->>'creditType', 'LEGACY_POINTS')
  AND redemption."pointTypeId" IS NULL;

-- Replace only untouched generated defaults; administrator-edited templates
-- remain exactly as configured.
UPDATE "NotificationTemplate"
SET
  "subject" = 'You received recognition',
  "bodyText" = '{{message}} You received {{amount}} {{pointType.name}}.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'credit-received'
  AND "subject" = 'You received recognition credits'
  AND "bodyText" = '{{message}} You received {{amount}} R-credit.';

UPDATE "NotificationTemplate"
SET
  "subject" = 'Your points are expiring soon',
  "bodyText" = '{{amount}} {{pointType.name}} expires in {{days}} days.',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'credit-expiring'
  AND "subject" = 'Your P-credit is expiring soon'
  AND "bodyText" = '{{amount}} P-credit expires in {{days}} days.';
