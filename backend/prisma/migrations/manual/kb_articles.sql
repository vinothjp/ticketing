-- Migration: kb_articles (Knowledge Base)
-- Applied to dev via `prisma db push`; committed for review. NON-DESTRUCTIVE:
-- adds the KbArticle + KbAttachment tables and a per-org document-number sequence.

-- CreateTable: KbArticle (structured article)
CREATE TABLE "KbArticle" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "documentNumber" TEXT,
    "articleType" TEXT NOT NULL DEFAULT 'KNOWLEDGE',   -- KNOWLEDGE | PROBLEM
    "title" TEXT NOT NULL,
    "category" TEXT,
    "subCategory" TEXT,
    "module" TEXT,
    "subject" TEXT,
    "versionNumber" TEXT,
    "body" TEXT NOT NULL,                              -- "Content"
    "problemDescription" TEXT,
    "resolution" TEXT,
    "cause" TEXT,
    "prevention" TEXT,
    "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "urlReferences" JSONB NOT NULL DEFAULT '[]',        -- [{ label?, url }]
    "status" TEXT NOT NULL DEFAULT 'DRAFT',            -- DRAFT | PUBLISHED
    "audience" TEXT NOT NULL DEFAULT 'INTERNAL',        -- INTERNAL | CUSTOMER
    "knowledgeOwnerId" TEXT,
    "knowledgeOwnerName" TEXT,
    "publishedDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdByName" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KbArticle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KbArticle_clientId_status_idx" ON "KbArticle"("clientId", "status");

-- AddForeignKey
ALTER TABLE "KbArticle" ADD CONSTRAINT "KbArticle_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: KbAttachment (up to 5 files, 5 MB each)
CREATE TABLE "KbAttachment" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT,
    CONSTRAINT "KbAttachment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "KbAttachment" ADD CONSTRAINT "KbAttachment_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "KbArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: per-org document-number sequence (KB-000001)
ALTER TABLE "Client" ADD COLUMN "kbSequence" INTEGER NOT NULL DEFAULT 0;
