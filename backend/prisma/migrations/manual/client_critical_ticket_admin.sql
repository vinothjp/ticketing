-- Critical ticket admin on the Organization screen: an address that is emailed
-- every Critical ticket, and the switch that turns it on. Off by default, so no
-- organization starts sending until an Admin opts in. Idempotent.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "criticalTicketEmail" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "criticalTicketAlerts" BOOLEAN NOT NULL DEFAULT false;
