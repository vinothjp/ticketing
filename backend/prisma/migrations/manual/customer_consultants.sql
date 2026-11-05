-- Customer-level consultants for ticket auto-assignment (optional overrides).
CREATE TABLE IF NOT EXISTS "CustomerConsultant" (
  "id"                TEXT PRIMARY KEY,
  "clientId"          TEXT NOT NULL,
  "customerCompanyId" TEXT NOT NULL REFERENCES "CustomerCompany"("id") ON DELETE CASCADE,
  "userId"            TEXT NOT NULL,
  "productId"         TEXT,
  "moduleId"          TEXT,
  "track"             TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "CustomerConsultant_customerCompanyId_idx" ON "CustomerConsultant"("customerCompanyId");
