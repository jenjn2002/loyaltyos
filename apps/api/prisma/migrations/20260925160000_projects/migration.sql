CREATE TABLE "ProjectFieldDefinition" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "MemberFieldType" NOT NULL DEFAULT 'TEXT',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectFieldDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "createdByAdminId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fieldValues" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "activatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectPointBudget" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "pointTypeId" TEXT NOT NULL,
    "requestedAmount" INTEGER NOT NULL DEFAULT 0,
    "approvedAmount" INTEGER NOT NULL,
    "remainingAmount" INTEGER NOT NULL,
    "issuedAmount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectPointBudget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectBudgetTransaction" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "pointTypeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectBudgetTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "invitedByAdminId" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "dueAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectIssueBatch" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "approvalRequestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "ProjectIssueBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectGrantAllocation" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "pointTypeId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectGrantAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectFieldDefinition_programId_key_key" ON "ProjectFieldDefinition"("programId", "key");
CREATE INDEX "ProjectFieldDefinition_programId_isActive_sortOrder_idx" ON "ProjectFieldDefinition"("programId", "isActive", "sortOrder");
CREATE INDEX "Project_programId_status_updatedAt_idx" ON "Project"("programId", "status", "updatedAt");
CREATE INDEX "Project_createdByAdminId_updatedAt_idx" ON "Project"("createdByAdminId", "updatedAt");
CREATE UNIQUE INDEX "ProjectPointBudget_projectId_pointTypeId_key" ON "ProjectPointBudget"("projectId", "pointTypeId");
CREATE INDEX "ProjectPointBudget_pointTypeId_idx" ON "ProjectPointBudget"("pointTypeId");
CREATE UNIQUE INDEX "ProjectBudgetTransaction_projectId_idempotencyKey_key" ON "ProjectBudgetTransaction"("projectId", "idempotencyKey");
CREATE INDEX "ProjectBudgetTransaction_projectId_createdAt_idx" ON "ProjectBudgetTransaction"("projectId", "createdAt");
CREATE UNIQUE INDEX "ProjectMember_projectId_memberId_key" ON "ProjectMember"("projectId", "memberId");
CREATE INDEX "ProjectMember_memberId_status_idx" ON "ProjectMember"("memberId", "status");
CREATE INDEX "ProjectTask_projectId_status_sortOrder_idx" ON "ProjectTask"("projectId", "status", "sortOrder");
CREATE INDEX "ProjectTask_assigneeId_status_idx" ON "ProjectTask"("assigneeId", "status");
CREATE UNIQUE INDEX "ProjectIssueBatch_approvalRequestId_key" ON "ProjectIssueBatch"("approvalRequestId");
CREATE INDEX "ProjectIssueBatch_projectId_createdAt_idx" ON "ProjectIssueBatch"("projectId", "createdAt");
CREATE INDEX "ProjectGrantAllocation_batchId_idx" ON "ProjectGrantAllocation"("batchId");
CREATE INDEX "ProjectGrantAllocation_projectId_memberId_idx" ON "ProjectGrantAllocation"("projectId", "memberId");

ALTER TABLE "ProjectFieldDefinition" ADD CONSTRAINT "ProjectFieldDefinition_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectPointBudget" ADD CONSTRAINT "ProjectPointBudget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectPointBudget" ADD CONSTRAINT "ProjectPointBudget_pointTypeId_fkey" FOREIGN KEY ("pointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectBudgetTransaction" ADD CONSTRAINT "ProjectBudgetTransaction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectBudgetTransaction" ADD CONSTRAINT "ProjectBudgetTransaction_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "ProjectPointBudget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectBudgetTransaction" ADD CONSTRAINT "ProjectBudgetTransaction_pointTypeId_fkey" FOREIGN KEY ("pointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectIssueBatch" ADD CONSTRAINT "ProjectIssueBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectGrantAllocation" ADD CONSTRAINT "ProjectGrantAllocation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProjectIssueBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectGrantAllocation" ADD CONSTRAINT "ProjectGrantAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectGrantAllocation" ADD CONSTRAINT "ProjectGrantAllocation_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "ProjectPointBudget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectGrantAllocation" ADD CONSTRAINT "ProjectGrantAllocation_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectGrantAllocation" ADD CONSTRAINT "ProjectGrantAllocation_pointTypeId_fkey" FOREIGN KEY ("pointTypeId") REFERENCES "PointTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
