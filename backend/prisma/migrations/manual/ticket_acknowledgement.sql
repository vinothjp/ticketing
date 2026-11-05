-- Client acknowledgement of a resolved ticket.
--
-- The customer contact confirms the resolution, which is the one customer-side
-- transition that closes a ticket. `acknowledgedAt` doubles as the duplicate
-- guard: a second acknowledgement is rejected while it is non-null.
-- Idempotent — safe to re-run.

ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "acknowledgedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "acknowledgedById" TEXT;
