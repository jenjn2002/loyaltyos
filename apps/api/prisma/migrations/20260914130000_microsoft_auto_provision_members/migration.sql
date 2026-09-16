-- Existing configurations remain disabled for auto-provisioning. New
-- configurations use the Prisma default (true) when created by the API.
ALTER TABLE "MicrosoftAuthConfig"
    ADD COLUMN "autoProvisionMembers" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "MicrosoftAuthConfig"
    ALTER COLUMN "autoProvisionMembers" SET DEFAULT true;

ALTER TABLE "MicrosoftAuthConfig"
    DROP COLUMN "allowEmailLinking";
