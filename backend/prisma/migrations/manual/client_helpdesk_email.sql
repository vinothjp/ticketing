-- Helpdesk email on the Organization screen: CC'd on every ticket email.
-- Null = no CC, so nothing changes until an Admin enters one. Idempotent.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "helpdeskEmail" TEXT;
