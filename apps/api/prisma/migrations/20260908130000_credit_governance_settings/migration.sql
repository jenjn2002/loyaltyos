-- Credit governance settings and role-scoped permissions.
CREATE TABLE "CreditSetting" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditSetting_programId_key_key" ON "CreditSetting"("programId", "key");
CREATE INDEX "CreditSetting_programId_updatedAt_idx" ON "CreditSetting"("programId", "updatedAt");

ALTER TABLE "CreditSetting"
ADD CONSTRAINT "CreditSetting_programId_fkey"
FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CreditSettingPermission" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "settingKey" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditSettingPermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditSettingPermission_programId_settingKey_role_key"
ON "CreditSettingPermission"("programId", "settingKey", "role");
CREATE INDEX "CreditSettingPermission_programId_role_idx"
ON "CreditSettingPermission"("programId", "role");

ALTER TABLE "CreditSettingPermission"
ADD CONSTRAINT "CreditSettingPermission_programId_fkey"
FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
