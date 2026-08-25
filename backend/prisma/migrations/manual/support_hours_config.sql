-- Client + per-product support-hours configuration:
--   period (FULL_AMC | MONTHLY), carry-forward, allow-excess, excess-approval,
--   a named approver, and a per-month ledger. Idempotent — safe to re-run.

-- Shared customer contract config (CustomerCompany).
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "contractHoursPeriod"      TEXT    NOT NULL DEFAULT 'FULL_AMC';
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "contractCarryForward"     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "contractAllowExcess"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "contractExcessApproval"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "contractExcessApproverId" TEXT;

-- Per-product config (CustomerCompanyProduct).
ALTER TABLE "CustomerCompanyProduct" ADD COLUMN IF NOT EXISTS "amcHoursPeriod"      TEXT    NOT NULL DEFAULT 'FULL_AMC';
ALTER TABLE "CustomerCompanyProduct" ADD COLUMN IF NOT EXISTS "amcCarryForward"     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerCompanyProduct" ADD COLUMN IF NOT EXISTS "amcAllowExcess"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerCompanyProduct" ADD COLUMN IF NOT EXISTS "amcExcessApproval"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerCompanyProduct" ADD COLUMN IF NOT EXISTS "amcExcessApproverId" TEXT;

-- Approver FKs → User (nullable; clear on user delete).
DO $$ BEGIN
  ALTER TABLE "CustomerCompany"
    ADD CONSTRAINT "CustomerCompany_contractExcessApproverId_fkey"
    FOREIGN KEY ("contractExcessApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CustomerCompanyProduct"
    ADD CONSTRAINT "CustomerCompanyProduct_amcExcessApproverId_fkey"
    FOREIGN KEY ("amcExcessApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Monthly ledger, one row per (scope, ownerId, month).
CREATE TABLE IF NOT EXISTS "SupportHoursLedger" (
  "id"          TEXT NOT NULL,
  "clientId"    TEXT NOT NULL,
  "scope"       TEXT NOT NULL,
  "ownerId"     TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodLabel" TEXT NOT NULL,
  "allocated"   INTEGER NOT NULL,
  "carriedIn"   INTEGER NOT NULL DEFAULT 0,
  "used"        DECIMAL(65,30) NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportHoursLedger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SupportHoursLedger_scope_ownerId_periodLabel_key"
  ON "SupportHoursLedger" ("scope", "ownerId", "periodLabel");
CREATE INDEX IF NOT EXISTS "SupportHoursLedger_clientId_idx"
  ON "SupportHoursLedger" ("clientId");
