-- Excess-hours approval removed; replaced by a typed rate per excess hour on
-- each support-hours pool. The approval columns and SupportHoursExcessRequest
-- are left in place, unused (dropping them would lose data on deploy).
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "contractExcessRate" DECIMAL(65,30);
ALTER TABLE "CustomerCompanyProduct" ADD COLUMN IF NOT EXISTS "amcExcessRate" DECIMAL(65,30);
