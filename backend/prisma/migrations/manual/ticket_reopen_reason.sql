-- Reason captured when a client reopens a ticket. Idempotent: safe to re-run.
ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "reopenReason" TEXT,
  ADD COLUMN IF NOT EXISTS "reopenedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reopenedById" TEXT;
