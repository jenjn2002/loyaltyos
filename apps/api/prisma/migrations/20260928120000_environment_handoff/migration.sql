CREATE TABLE "EnvironmentHandoffUse" (
    "jti" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EnvironmentHandoffUse_pkey" PRIMARY KEY ("jti")
);

CREATE INDEX "EnvironmentHandoffUse_expiresAt_idx" ON "EnvironmentHandoffUse"("expiresAt");
