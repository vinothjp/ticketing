-- Customer-purchased products with warranty + AMC coverage, and product requests.

ALTER TABLE "CustomerCompanyProduct"
  ADD COLUMN IF NOT EXISTS "status"            TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "purchaseDate"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "warrantyMonths"    INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS "warrantyEnd"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "freeAmcMonths"     INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS "amcType"           TEXT NOT NULL DEFAULT 'FREE',
  ADD COLUMN IF NOT EXISTS "amcStart"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "amcEnd"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "amcMonthlyCost"    DECIMAL,
  ADD COLUMN IF NOT EXISTS "amcHoursPerMonth"  INTEGER,
  ADD COLUMN IF NOT EXISTS "amcVisitsPerMonth" INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "expiryAlertSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "ProductRequest" (
  "id"                TEXT PRIMARY KEY,
  "clientId"          TEXT NOT NULL,
  "customerCompanyId" TEXT NOT NULL REFERENCES "CustomerCompany"("id") ON DELETE CASCADE,
  "productId"         TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE,
  "note"              TEXT,
  "status"            TEXT NOT NULL DEFAULT 'PENDING',
  "decisionNote"      TEXT,
  "requestedById"     TEXT,
  "decidedById"       TEXT,
  "decidedAt"         TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ProductRequest_customerCompanyId_idx" ON "ProductRequest"("customerCompanyId");
CREATE INDEX IF NOT EXISTS "ProductRequest_productId_idx" ON "ProductRequest"("productId");
