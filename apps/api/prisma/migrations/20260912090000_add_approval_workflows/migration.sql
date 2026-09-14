CREATE TYPE "WorkflowApprovalMode" AS ENUM ('ANY', 'ALL', 'COUNT');

CREATE TYPE "WorkflowSelfApprovalPolicy" AS ENUM ('DENY', 'ALLOW');

CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TYPE "ApprovalRequestStepStatus" AS ENUM ('WAITING', 'PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');

CREATE TYPE "ApprovalDecisionType" AS ENUM ('APPROVE', 'REJECT');

CREATE TABLE "ApprovalWorkflow" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "selfApprovalPolicy" "WorkflowSelfApprovalPolicy" NOT NULL DEFAULT 'DENY',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalWorkflow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApprovalWorkflow_programId_actionKey_key" ON "ApprovalWorkflow"("programId", "actionKey");
CREATE INDEX "ApprovalWorkflow_programId_isActive_idx" ON "ApprovalWorkflow"("programId", "isActive");

CREATE TABLE "ApprovalWorkflowStep" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "approvalMode" "WorkflowApprovalMode" NOT NULL DEFAULT 'ANY',
    "requiredApprovalCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalWorkflowStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApprovalWorkflowStep_workflowId_stepOrder_key" ON "ApprovalWorkflowStep"("workflowId", "stepOrder");
CREATE INDEX "ApprovalWorkflowStep_workflowId_stepOrder_idx" ON "ApprovalWorkflowStep"("workflowId", "stepOrder");

CREATE TABLE "ApprovalWorkflowAssignee" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "adminUserId" TEXT,
    "role" "AdminRole",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalWorkflowAssignee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApprovalWorkflowAssignee_stepId_adminUserId_key" ON "ApprovalWorkflowAssignee"("stepId", "adminUserId");
CREATE UNIQUE INDEX "ApprovalWorkflowAssignee_stepId_role_key" ON "ApprovalWorkflowAssignee"("stepId", "role");
CREATE INDEX "ApprovalWorkflowAssignee_adminUserId_idx" ON "ApprovalWorkflowAssignee"("adminUserId");

CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByType" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requesterAdminId" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "workflowSnapshot" JSONB NOT NULL DEFAULT '{}',
    "currentStepOrder" INTEGER,
    "idempotencyKey" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolutionComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApprovalRequest_programId_actionKey_idempotencyKey_key" ON "ApprovalRequest"("programId", "actionKey", "idempotencyKey");
CREATE INDEX "ApprovalRequest_programId_status_requestedAt_idx" ON "ApprovalRequest"("programId", "status", "requestedAt");
CREATE INDEX "ApprovalRequest_programId_actionKey_subjectType_subjectId_idx" ON "ApprovalRequest"("programId", "actionKey", "subjectType", "subjectId");
CREATE INDEX "ApprovalRequest_requesterAdminId_idx" ON "ApprovalRequest"("requesterAdminId");

CREATE TABLE "ApprovalRequestStep" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "approvalMode" "WorkflowApprovalMode" NOT NULL DEFAULT 'ANY',
    "requiredApprovalCount" INTEGER NOT NULL DEFAULT 1,
    "assigneesSnapshot" JSONB NOT NULL DEFAULT '[]',
    "status" "ApprovalRequestStepStatus" NOT NULL DEFAULT 'WAITING',
    "openedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalRequestStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApprovalRequestStep_approvalRequestId_stepOrder_key" ON "ApprovalRequestStep"("approvalRequestId", "stepOrder");
CREATE INDEX "ApprovalRequestStep_approvalRequestId_status_idx" ON "ApprovalRequestStep"("approvalRequestId", "status");

CREATE TABLE "ApprovalDecision" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "approverAdminId" TEXT NOT NULL,
    "decision" "ApprovalDecisionType" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApprovalDecision_stepId_approverAdminId_key" ON "ApprovalDecision"("stepId", "approverAdminId");
CREATE INDEX "ApprovalDecision_programId_approverAdminId_createdAt_idx" ON "ApprovalDecision"("programId", "approverAdminId", "createdAt");
CREATE INDEX "ApprovalDecision_approvalRequestId_createdAt_idx" ON "ApprovalDecision"("approvalRequestId", "createdAt");

ALTER TABLE "PointExchangeRequest" ADD COLUMN "approvalRequestId" TEXT;
CREATE UNIQUE INDEX "PointExchangeRequest_approvalRequestId_key" ON "PointExchangeRequest"("approvalRequestId");

ALTER TABLE "ApprovalWorkflow" ADD CONSTRAINT "ApprovalWorkflow_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalWorkflowStep" ADD CONSTRAINT "ApprovalWorkflowStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ApprovalWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalWorkflowAssignee" ADD CONSTRAINT "ApprovalWorkflowAssignee_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "ApprovalWorkflowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalWorkflowAssignee" ADD CONSTRAINT "ApprovalWorkflowAssignee_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ApprovalWorkflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequestStep" ADD CONSTRAINT "ApprovalRequestStep_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "ApprovalRequestStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_approverAdminId_fkey" FOREIGN KEY ("approverAdminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PointExchangeRequest" ADD CONSTRAINT "PointExchangeRequest_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
