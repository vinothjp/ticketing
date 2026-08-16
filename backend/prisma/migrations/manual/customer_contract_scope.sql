-- Product contract scope: per-product terms vs one shared customer contract.
ALTER TABLE "CustomerCompany"
  ADD COLUMN IF NOT EXISTS "contractScope" TEXT NOT NULL DEFAULT 'PRODUCT',
  ADD COLUMN IF NOT EXISTS "contractStart" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "contractEnd"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "contractHours" INTEGER;
