-- Explicit "unlimited support hours" state for warranty / AMC coverage.
--
-- Until now a NULL hours pool meant "no pool", which the UI rendered as
-- "Not included" even though nothing was ever capped. Warranty is free support,
-- so it now defaults to Unlimited and carries that intent explicitly.
--
-- Idempotent: safe to re-run.

-- ---- shared customer contract ---------------------------------------------
ALTER TABLE "CustomerCompany"
  ADD COLUMN IF NOT EXISTS "contractHoursUnlimited" BOOLEAN NOT NULL DEFAULT false;

-- Existing rows with no pool were already uncapped — record that as unlimited.
UPDATE "CustomerCompany"
   SET "contractHoursUnlimited" = true
 WHERE "contractHours" IS NULL
   AND "contractHoursUnlimited" = false;

-- ---- per-product coverage ---------------------------------------------------
-- Added as false first so existing rows keep their current (capped) behaviour,
-- then the warranty flag flips to a true DEFAULT for newly created rows.
ALTER TABLE "CustomerCompanyProduct"
  ADD COLUMN IF NOT EXISTS "freeAmcHoursUnlimited" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerCompanyProduct"
  ADD COLUMN IF NOT EXISTS "paidAmcHoursUnlimited" BOOLEAN NOT NULL DEFAULT false;

UPDATE "CustomerCompanyProduct"
   SET "freeAmcHoursUnlimited" = true
 WHERE "freeAmcHours" IS NULL
   AND "freeAmcHoursUnlimited" = false;

UPDATE "CustomerCompanyProduct"
   SET "paidAmcHoursUnlimited" = true
 WHERE "paidAmcHours" IS NULL
   AND "paidAmcHoursUnlimited" = false;

-- Warranty is free support: new coverage rows start unlimited.
ALTER TABLE "CustomerCompanyProduct"
  ALTER COLUMN "freeAmcHoursUnlimited" SET DEFAULT true;

-- An unlimited pool never carries an allocation.
UPDATE "CustomerCompany"        SET "contractHours" = NULL WHERE "contractHoursUnlimited" AND "contractHours" IS NOT NULL;
UPDATE "CustomerCompanyProduct" SET "freeAmcHours"  = NULL WHERE "freeAmcHoursUnlimited"  AND "freeAmcHours"  IS NOT NULL;
UPDATE "CustomerCompanyProduct" SET "paidAmcHours"  = NULL WHERE "paidAmcHoursUnlimited"  AND "paidAmcHours"  IS NOT NULL;
