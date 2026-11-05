-- Whether a client may still raise tickets once its support-hours allowance is
-- spent. Mirrored on both pools: the shared customer contract (contract*) and a
-- per-product coverage (amc*). Defaults to TRUE so existing clients keep today's
-- behaviour — support does not stop the moment the hours run out.
ALTER TABLE "CustomerCompany"
  ADD COLUMN IF NOT EXISTS "contractAllowTicketsAfterHours" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "CustomerCompanyProduct"
  ADD COLUMN IF NOT EXISTS "amcAllowTicketsAfterHours" BOOLEAN NOT NULL DEFAULT true;
