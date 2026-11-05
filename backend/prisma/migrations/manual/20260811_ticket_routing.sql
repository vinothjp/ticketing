-- Ticket SAP routing fields + customer-company product usage.
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "productId"      TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "moduleId"       TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "consultantType" TEXT;

CREATE TABLE IF NOT EXISTS "CustomerCompanyProduct" (
  id                  TEXT PRIMARY KEY,
  "customerCompanyId" TEXT NOT NULL REFERENCES "CustomerCompany"(id) ON DELETE CASCADE,
  "productId"         TEXT NOT NULL REFERENCES "Product"(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerCompanyProduct_customerCompanyId_productId_key"
  ON "CustomerCompanyProduct" ("customerCompanyId", "productId");
CREATE INDEX IF NOT EXISTS "CustomerCompanyProduct_productId_idx" ON "CustomerCompanyProduct" ("productId");
