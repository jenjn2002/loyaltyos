-- Extensible point-type registry and member wallets.
CREATE TABLE "PointTypeDefinition" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitLabel" TEXT NOT NULL DEFAULT 'points',
    "description" TEXT,
    "color" TEXT,
    "expiryMode" TEXT NOT NULL DEFAULT 'NEVER',
    "expiryDays" INTEGER,
    "allowNegativeBalance" BOOLEAN NOT NULL DEFAULT false,
    "allowManualAdjustment" BOOLEAN NOT NULL DEFAULT true,
    "transferable" BOOLEAN NOT NULL DEFAULT false,
    "redeemable" BOOLEAN NOT NULL DEFAULT false,
    "exchangeable" BOOLEAN NOT NULL DEFAULT false,
    "cashEligible" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PointTypeDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PointTypeDefinition_programId_code_key"
ON "PointTypeDefinition"("programId", "code");
CREATE INDEX "PointTypeDefinition_programId_isActive_idx"
ON "PointTypeDefinition"("programId", "isActive");

ALTER TABLE "PointTypeDefinition"
ADD CONSTRAINT "PointTypeDefinition_programId_fkey"
FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CustomPointWallet" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "pointTypeId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "totalEarned" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomPointWallet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomPointWallet_memberId_pointTypeId_key"
ON "CustomPointWallet"("memberId", "pointTypeId");
CREATE INDEX "CustomPointWallet_programId_pointTypeId_idx"
ON "CustomPointWallet"("programId", "pointTypeId");

ALTER TABLE "CustomPointWallet"
ADD CONSTRAINT "CustomPointWallet_memberId_fkey"
FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomPointWallet"
ADD CONSTRAINT "CustomPointWallet_programId_fkey"
FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomPointWallet"
ADD CONSTRAINT "CustomPointWallet_pointTypeId_fkey"
FOREIGN KEY ("pointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CustomPointTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "pointTypeId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT,
    "actorType" TEXT,
    "actorId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomPointTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomPointTransaction_idempotencyKey_key"
ON "CustomPointTransaction"("idempotencyKey");
CREATE INDEX "CustomPointTransaction_memberId_pointTypeId_createdAt_idx"
ON "CustomPointTransaction"("memberId", "pointTypeId", "createdAt");
CREATE INDEX "CustomPointTransaction_programId_pointTypeId_createdAt_idx"
ON "CustomPointTransaction"("programId", "pointTypeId", "createdAt");
CREATE INDEX "CustomPointTransaction_expiresAt_idx"
ON "CustomPointTransaction"("expiresAt");

ALTER TABLE "CustomPointTransaction"
ADD CONSTRAINT "CustomPointTransaction_walletId_fkey"
FOREIGN KEY ("walletId") REFERENCES "CustomPointWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomPointTransaction"
ADD CONSTRAINT "CustomPointTransaction_memberId_fkey"
FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomPointTransaction"
ADD CONSTRAINT "CustomPointTransaction_programId_fkey"
FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomPointTransaction"
ADD CONSTRAINT "CustomPointTransaction_pointTypeId_fkey"
FOREIGN KEY ("pointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CustomPointLot" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "pointTypeId" TEXT NOT NULL,
    "grantTransactionId" TEXT NOT NULL,
    "originalAmount" INTEGER NOT NULL,
    "remainingAmount" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomPointLot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomPointLot_grantTransactionId_key"
ON "CustomPointLot"("grantTransactionId");
CREATE INDEX "CustomPointLot_memberId_pointTypeId_remainingAmount_expiresAt_idx"
ON "CustomPointLot"("memberId", "pointTypeId", "remainingAmount", "expiresAt");

ALTER TABLE "CustomPointLot"
ADD CONSTRAINT "CustomPointLot_walletId_fkey"
FOREIGN KEY ("walletId") REFERENCES "CustomPointWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomPointLot"
ADD CONSTRAINT "CustomPointLot_memberId_fkey"
FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomPointLot"
ADD CONSTRAINT "CustomPointLot_programId_fkey"
FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomPointLot"
ADD CONSTRAINT "CustomPointLot_pointTypeId_fkey"
FOREIGN KEY ("pointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomPointLot"
ADD CONSTRAINT "CustomPointLot_grantTransactionId_fkey"
FOREIGN KEY ("grantTransactionId") REFERENCES "CustomPointTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
