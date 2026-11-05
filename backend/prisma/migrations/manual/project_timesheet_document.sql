-- Migration: project_timesheet_document — cross-project weekly timesheet
-- Adds Excel "Document Number" / "Document Date" to timesheet entries and a
-- (userId, date) index for fast per-consultant week lookups. Status now also
-- allows 'DRAFT' (plain text column — no enum change needed).

ALTER TABLE "ProjectTimesheet" ADD COLUMN IF NOT EXISTS "documentNumber" TEXT;
ALTER TABLE "ProjectTimesheet" ADD COLUMN IF NOT EXISTS "documentDate" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ProjectTimesheet_userId_date_idx" ON "ProjectTimesheet"("userId", "date");
