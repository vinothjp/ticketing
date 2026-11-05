-- SLA policy: every-response target, operational hours basis and escalation flag.
ALTER TABLE "SlaPolicy" ADD COLUMN IF NOT EXISTS "everyResponseHours" INTEGER;
ALTER TABLE "SlaPolicy" ADD COLUMN IF NOT EXISTS "operationalHours" TEXT NOT NULL DEFAULT 'CALENDAR';
ALTER TABLE "SlaPolicy" ADD COLUMN IF NOT EXISTS "escalationEnabled" BOOLEAN NOT NULL DEFAULT true;
