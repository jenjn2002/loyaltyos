ALTER TABLE "ApprovalWorkflow"
ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "scope" JSONB NOT NULL DEFAULT '{}';

DROP INDEX IF EXISTS "ApprovalWorkflow_programId_actionKey_key";
CREATE INDEX "ApprovalWorkflow_programId_actionKey_isActive_priority_idx"
ON "ApprovalWorkflow"("programId", "actionKey", "isActive", "priority");

ALTER TABLE "ApprovalRequest"
ADD COLUMN "scopeSnapshot" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "RewardRedemption"
ADD COLUMN "approvalRequestId" TEXT;

CREATE UNIQUE INDEX "RewardRedemption_approvalRequestId_key"
ON "RewardRedemption"("approvalRequestId");

ALTER TABLE "RewardRedemption"
ADD CONSTRAINT "RewardRedemption_approvalRequestId_fkey"
FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
