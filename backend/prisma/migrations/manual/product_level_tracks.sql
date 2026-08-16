-- Product-level tracks + product-level agent assignments (module optional).
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "tracks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS "ProductConsultant" (
  "id"        TEXT PRIMARY KEY,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE,
  "track"     TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ProductConsultant_productId_idx" ON "ProductConsultant"("productId");
