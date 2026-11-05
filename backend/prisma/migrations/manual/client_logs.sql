-- Client logs: visits / remote sessions / calls booked against a customer's
-- contract pool. Idempotent so it can be re-applied to an already-migrated DB.

ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "clientLogSequence" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "ClientLog" (
  "id"                TEXT NOT NULL,
  "clientId"          TEXT NOT NULL,
  "logNumber"         TEXT,
  "visitDate"         TIMESTAMP(3) NOT NULL,
  "customerCompanyId" TEXT NOT NULL,
  "consultantId"      TEXT NOT NULL,
  "consultantName"    TEXT,
  "hours"             DECIMAL(65,30) NOT NULL DEFAULT 0,
  "purpose"           TEXT NOT NULL,
  "notes"             TEXT,
  "visitType"         TEXT NOT NULL DEFAULT 'ON_SITE',
  "status"            TEXT NOT NULL DEFAULT 'PLANNED',
  "ticketId"          TEXT,
  "projectId"         TEXT,
  "contractDeducted"  BOOLEAN NOT NULL DEFAULT false,
  "createdBy"         TEXT,
  "updatedBy"         TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ClientLog_clientId_customerCompanyId_idx"
  ON "ClientLog" ("clientId", "customerCompanyId");
CREATE INDEX IF NOT EXISTS "ClientLog_clientId_consultantId_idx"
  ON "ClientLog" ("clientId", "consultantId");

DO $$ BEGIN
  ALTER TABLE "ClientLog" ADD CONSTRAINT "ClientLog_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ClientLog" ADD CONSTRAINT "ClientLog_customerCompanyId_fkey"
    FOREIGN KEY ("customerCompanyId") REFERENCES "CustomerCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
