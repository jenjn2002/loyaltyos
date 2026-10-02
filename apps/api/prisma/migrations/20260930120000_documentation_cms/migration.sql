CREATE TYPE "DocumentationAudience" AS ENUM ('CUSTOMER', 'ADMIN');
CREATE TYPE "DocumentationArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED');

ALTER TABLE "Program" ADD COLUMN "documentationConfigured" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "DocumentationArticle" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "audience" "DocumentationAudience" NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "DocumentationArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "imageKey" TEXT,
    "imageData" TEXT,
    "content" JSONB NOT NULL DEFAULT '{}',
    "createdByAdminId" TEXT,
    "updatedByAdminId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DocumentationArticle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentationArticle_programId_audience_slug_key"
ON "DocumentationArticle"("programId", "audience", "slug");
CREATE INDEX "DocumentationArticle_programId_audience_status_sortOrder_idx"
ON "DocumentationArticle"("programId", "audience", "status", "sortOrder");

ALTER TABLE "DocumentationArticle"
ADD CONSTRAINT "DocumentationArticle_programId_fkey"
FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
