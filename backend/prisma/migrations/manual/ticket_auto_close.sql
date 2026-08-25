-- Tenant-editable auto-close window: how many days a resolved ticket waits for
-- the client's acknowledgement before it closes itself.
-- Idempotent: safe to re-run.
ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "ticketAutoCloseDays" INTEGER NOT NULL DEFAULT 3;
