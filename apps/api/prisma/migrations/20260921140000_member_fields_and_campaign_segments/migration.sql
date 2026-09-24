CREATE TYPE "MemberFieldType" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SELECT');

CREATE TABLE "MemberFieldDefinition" (
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

    CONSTRAINT "MemberFieldDefinition_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Campaign" ADD COLUMN "segmentId" TEXT;

CREATE UNIQUE INDEX "MemberFieldDefinition_programId_key_key" ON "MemberFieldDefinition"("programId", "key");
CREATE INDEX "MemberFieldDefinition_programId_isActive_sortOrder_idx" ON "MemberFieldDefinition"("programId", "isActive", "sortOrder");
CREATE INDEX "Campaign_segmentId_idx" ON "Campaign"("segmentId");

ALTER TABLE "MemberFieldDefinition"
  ADD CONSTRAINT "MemberFieldDefinition_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Campaign"
  ADD CONSTRAINT "Campaign_segmentId_fkey"
  FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
