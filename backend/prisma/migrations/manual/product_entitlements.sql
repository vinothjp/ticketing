-- Support-hours + visit allocations and usage tracking on a customer's product.
ALTER TABLE "CustomerCompanyProduct"
  ADD COLUMN IF NOT EXISTS "freeAmcHours"        INTEGER,
  ADD COLUMN IF NOT EXISTS "freeAmcVisits"       INTEGER,
  ADD COLUMN IF NOT EXISTS "paidAmcMonths"       INTEGER,
  ADD COLUMN IF NOT EXISTS "paidAmcHours"        INTEGER,
  ADD COLUMN IF NOT EXISTS "paidAmcVisits"       INTEGER,
  ADD COLUMN IF NOT EXISTS "hoursUsed"           DECIMAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "visitsUsed"          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "warrantyAlertSentAt" TIMESTAMP(3);
