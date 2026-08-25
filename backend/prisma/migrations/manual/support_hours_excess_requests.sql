-- Approval for logging beyond a client's support-hours allowance.
--
-- The row is a *permission*, not a time entry: with "Approval required for excess
-- hours" on, hitting the cap raises a PENDING request and refuses the log;
-- approving unlocks over-cap logging for that pool, and the consultant then logs
-- their time normally. Nothing is booked by the approval itself.
--
-- One live row per pool per period. `periodLabel` uses the 'ALL' sentinel for
-- FULL_AMC pools rather than NULL, because Postgres treats NULLs as distinct and
-- a nullable column in the unique index would let duplicates through.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "SupportHoursExcessRequest" (
  "id"                TEXT NOT NULL,
  "clientId"          TEXT NOT NULL,
  "customerCompanyId" TEXT NOT NULL,
  "scope"             TEXT NOT NULL,
  "ownerId"           TEXT NOT NULL,
  "periodLabel"       TEXT NOT NULL DEFAULT 'ALL',
  "allocated"         INTEGER NOT NULL,
  "usedAtRequest"     DECIMAL(65,30) NOT NULL,
  "productName"       TEXT,
  "requestedById"     TEXT,
  "requestedByName"   TEXT,
  "approverUserId"    TEXT,
  "approverName"      TEXT,
  "status"            TEXT NOT NULL DEFAULT 'PENDING',
  "decisionNote"      TEXT,
  "decidedAt"         TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportHoursExcessRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupportHoursExcessRequest_scope_ownerId_periodLabel_key"
  ON "SupportHoursExcessRequest" ("scope", "ownerId", "periodLabel");
CREATE INDEX IF NOT EXISTS "SupportHoursExcessRequest_clientId_status_idx"
  ON "SupportHoursExcessRequest" ("clientId", "status");

DO $$
BEGIN
  ALTER TABLE "SupportHoursExcessRequest"
    ADD CONSTRAINT "SupportHoursExcessRequest_customerCompanyId_fkey"
    FOREIGN KEY ("customerCompanyId") REFERENCES "CustomerCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
