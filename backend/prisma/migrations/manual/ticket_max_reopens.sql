-- Tenant-editable cap on how many times one ticket may be reopened.
-- Idempotent: safe to re-run.
ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "ticketMaxReopens" INTEGER NOT NULL DEFAULT 3;
