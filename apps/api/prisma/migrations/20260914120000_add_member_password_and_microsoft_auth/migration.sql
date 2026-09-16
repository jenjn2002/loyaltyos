-- Existing members intentionally receive no credential row. Admin/import
-- provisioning is required before portal login is available.
CREATE TABLE "MemberCredential" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "usernameNormalized" TEXT NOT NULL,
    "passwordHash" TEXT,
    "passwordChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MemberCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MemberCredential_memberId_key" ON "MemberCredential"("memberId");
CREATE UNIQUE INDEX "MemberCredential_programId_usernameNormalized_key"
    ON "MemberCredential"("programId", "usernameNormalized");
CREATE INDEX "MemberCredential_programId_username_idx"
    ON "MemberCredential"("programId", "username");

CREATE TABLE "MemberExternalIdentity" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MemberExternalIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MemberExternalIdentity_programId_provider_providerSubject_tenantId_key"
    ON "MemberExternalIdentity"("programId", "provider", "providerSubject", "tenantId");
CREATE UNIQUE INDEX "MemberExternalIdentity_programId_provider_tenantId_memberId_key"
    ON "MemberExternalIdentity"("programId", "provider", "tenantId", "memberId");
CREATE INDEX "MemberExternalIdentity_programId_memberId_idx"
    ON "MemberExternalIdentity"("programId", "memberId");

CREATE TABLE "MicrosoftAuthConfig" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "tenantId" TEXT,
    "clientId" TEXT,
    "encryptedClientSecret" TEXT,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY['openid', 'profile', 'email']::TEXT[],
    "allowEmailLinking" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MicrosoftAuthConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MicrosoftAuthConfig_programId_key" ON "MicrosoftAuthConfig"("programId");

ALTER TABLE "MemberCredential"
    ADD CONSTRAINT "MemberCredential_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberCredential"
    ADD CONSTRAINT "MemberCredential_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberExternalIdentity"
    ADD CONSTRAINT "MemberExternalIdentity_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberExternalIdentity"
    ADD CONSTRAINT "MemberExternalIdentity_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MicrosoftAuthConfig"
    ADD CONSTRAINT "MicrosoftAuthConfig_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
