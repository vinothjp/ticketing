-- Contract services on both coverage scopes: third-party integration, plan
-- roll-out, and whether CRs are covered (max per month, and the hours above
-- which a CR is chargeable). Stored terms; existing contracts default to "no".
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "contractThirdPartyIntegration" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "contractPlanRollout" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "contractCrApplicable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "contractCrMaxPerMonth" INTEGER;
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "contractCrMaxHours" DECIMAL(65,30);

ALTER TABLE "CustomerCompanyProduct" ADD COLUMN IF NOT EXISTS "amcThirdPartyIntegration" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerCompanyProduct" ADD COLUMN IF NOT EXISTS "amcPlanRollout" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerCompanyProduct" ADD COLUMN IF NOT EXISTS "amcCrApplicable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerCompanyProduct" ADD COLUMN IF NOT EXISTS "amcCrMaxPerMonth" INTEGER;
ALTER TABLE "CustomerCompanyProduct" ADD COLUMN IF NOT EXISTS "amcCrMaxHours" DECIMAL(65,30);
