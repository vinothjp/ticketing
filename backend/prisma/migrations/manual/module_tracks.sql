-- Move consultant tracks from the product level down to each module.

ALTER TABLE "ProductModule"
  ADD COLUMN IF NOT EXISTS "tracks" TEXT[] NOT NULL DEFAULT ARRAY['TECHNICAL','FUNCTIONAL'];

-- Carry each product's tracks onto its modules before dropping the product column.
UPDATE "ProductModule" pm
  SET "tracks" = p."tracks"
  FROM "Product" p
  WHERE pm."productId" = p."id" AND p."tracks" IS NOT NULL;

ALTER TABLE "Product" DROP COLUMN IF EXISTS "tracks";
