-- Per-client module switch on the client's product screen: the modules of a
-- purchased product that are inactive for that client. Empty = all active.
ALTER TABLE "CustomerCompanyProduct" ADD COLUMN IF NOT EXISTS "inactiveModuleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
