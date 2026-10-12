ALTER TABLE "ProjectIssueBatch" ADD COLUMN "description" TEXT,
  ADD COLUMN "evidence" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "fieldValues" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "CustomFunctionDefinition" (
  "id" TEXT NOT NULL PRIMARY KEY, "programId" TEXT NOT NULL,
  "key" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
  "context" TEXT NOT NULL DEFAULT 'CUSTOM', "fields" JSONB NOT NULL DEFAULT '[]',
  "states" JSONB NOT NULL DEFAULT '[]', "transitions" JSONB NOT NULL DEFAULT '[]',
  "readRoles" TEXT[] NOT NULL DEFAULT ARRAY['SUPER_ADMIN']::TEXT[],
  "writeRoles" TEXT[] NOT NULL DEFAULT ARRAY['SUPER_ADMIN']::TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true, "version" INTEGER NOT NULL DEFAULT 1, "createdByAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomFunctionDefinition_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CustomFunctionDefinition_programId_key_key" ON "CustomFunctionDefinition"("programId", "key");
CREATE UNIQUE INDEX "CustomFunctionDefinition_builtin_context_key" ON "CustomFunctionDefinition"("programId", "context") WHERE "context" <> 'CUSTOM';
CREATE INDEX "CustomFunctionDefinition_programId_context_isActive_idx" ON "CustomFunctionDefinition"("programId", "context", "isActive");

CREATE TABLE "CustomDocument" (
  "id" TEXT NOT NULL PRIMARY KEY, "programId" TEXT NOT NULL, "definitionId" TEXT NOT NULL,
  "recordId" TEXT, "title" TEXT NOT NULL, "values" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'DRAFT', "version" INTEGER NOT NULL DEFAULT 1,
  "approvalRequestId" TEXT, "pendingTransition" JSONB,
  "createdByAdminId" TEXT NOT NULL, "updatedByAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "archivedAt" TIMESTAMP(3),
  CONSTRAINT "CustomDocument_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CustomDocument_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "CustomFunctionDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CustomDocument_definitionId_recordId_key" ON "CustomDocument"("definitionId", "recordId");
CREATE UNIQUE INDEX "CustomDocument_approvalRequestId_key" ON "CustomDocument"("approvalRequestId");
CREATE INDEX "CustomDocument_programId_definitionId_archivedAt_updatedAt_idx" ON "CustomDocument"("programId", "definitionId", "archivedAt", "updatedAt");

CREATE TABLE "CustomAttachment" (
  "id" TEXT NOT NULL PRIMARY KEY, "programId" TEXT NOT NULL,
  "contextType" TEXT NOT NULL, "contextId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL, "size" INTEGER NOT NULL, "base64" TEXT NOT NULL,
  "uploadedByAdminId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomAttachment_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CustomAttachment_programId_contextType_contextId_idx" ON "CustomAttachment"("programId", "contextType", "contextId");
