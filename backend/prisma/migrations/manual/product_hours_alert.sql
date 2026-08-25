-- CustomerCompanyProduct.hoursAlertSentAt: once-per-period guard for the
-- "support hours running low" alert on a per-product coverage pool. Mirrors
-- expiryAlertSentAt / warrantyAlertSentAt; cleared when the terms or period change.
ALTER TABLE "CustomerCompanyProduct" ADD COLUMN IF NOT EXISTS "hoursAlertSentAt" TIMESTAMP(3);
