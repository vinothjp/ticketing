-- Client type: IMPLEMENTATION (services only, no AMC) | AMC (implementation + AMC).
-- Every existing client already has AMC terms, so the default keeps them all on AMC.
-- Idempotent: re-running changes nothing.
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "clientType" TEXT NOT NULL DEFAULT 'AMC';
