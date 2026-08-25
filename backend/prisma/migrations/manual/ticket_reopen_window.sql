-- Tenant-editable ticket reopen window (days after resolution).
-- Idempotent: safe to re-run.
ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "ticketReopenWindowDays" INTEGER NOT NULL DEFAULT 30;
