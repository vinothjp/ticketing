-- Tolerance hours: hours that may still be logged past a support-hours allowance
-- before the "Allow logging excess hours" rule applies. Mirrored per shared
-- contract and per client product, like the other support-hours settings.
-- Null means no tolerance. Idempotent; no back-fill.
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "contractToleranceHours" DECIMAL(65,30);
ALTER TABLE "CustomerCompanyProduct" ADD COLUMN IF NOT EXISTS "amcToleranceHours" DECIMAL(65,30);
