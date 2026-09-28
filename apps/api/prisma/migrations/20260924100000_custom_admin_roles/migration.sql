ALTER TABLE "AdminUser" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "AdminUser" ALTER COLUMN "role" TYPE TEXT USING "role"::text;
ALTER TABLE "AdminUser" ALTER COLUMN "role" SET DEFAULT 'OPERATOR';

ALTER TABLE "AdminRolePermission" ALTER COLUMN "role" TYPE TEXT USING "role"::text;
ALTER TABLE "CreditSettingPermission" ALTER COLUMN "role" TYPE TEXT USING "role"::text;
ALTER TABLE "ApprovalWorkflowAssignee" ALTER COLUMN "role" TYPE TEXT USING "role"::text;

DROP TYPE "AdminRole";

CREATE TABLE "AdminRoleDefinition" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminRoleDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminRoleDefinition_programId_role_key"
  ON "AdminRoleDefinition"("programId", "role");
CREATE INDEX "AdminRoleDefinition_programId_label_idx"
  ON "AdminRoleDefinition"("programId", "label");

ALTER TABLE "AdminRoleDefinition"
  ADD CONSTRAINT "AdminRoleDefinition_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "Program"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
