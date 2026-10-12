-- "Suggested announcements" on the Communications screen: one row per Projects
-- event worth announcing (project created, milestone signed off, project
-- completed), unique per event so nothing is suggested twice. Nothing is sent
-- automatically — an admin turns a suggestion into an announcement or dismisses it.
-- Generated from schema.prisma with `prisma migrate diff`, made idempotent.

CREATE TABLE IF NOT EXISTS "AnnouncementSuggestion" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "projectId" TEXT,
    "milestoneId" TEXT,
    "customerCompanyId" TEXT,
    "albumId" TEXT,
    "communicationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnnouncementSuggestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AnnouncementSuggestion_clientId_status_idx" ON "AnnouncementSuggestion"("clientId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "AnnouncementSuggestion_clientId_sourceKey_key" ON "AnnouncementSuggestion"("clientId", "sourceKey");
