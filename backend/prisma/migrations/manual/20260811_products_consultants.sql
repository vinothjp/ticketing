-- Products, modules, and consultant assignments (ticket auto-routing).
CREATE TABLE IF NOT EXISTS "Product" (
  id          TEXT PRIMARY KEY,
  "clientId"  TEXT NOT NULL REFERENCES "Client"(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL,
  "autoAssign" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "Product_clientId_name_key" ON "Product" ("clientId", name);

CREATE TABLE IF NOT EXISTS "ProductModule" (
  id          TEXT PRIMARY KEY,
  "productId" TEXT NOT NULL REFERENCES "Product"(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ProductModule_productId_idx" ON "ProductModule" ("productId");

CREATE TABLE IF NOT EXISTS "ModuleConsultant" (
  id         TEXT PRIMARY KEY,
  "moduleId" TEXT NOT NULL REFERENCES "ProductModule"(id) ON DELETE CASCADE,
  track      TEXT NOT NULL,      -- TECHNICAL | FUNCTIONAL
  rank       TEXT NOT NULL,      -- PRIMARY | SECONDARY
  "userId"   TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "ModuleConsultant_moduleId_track_rank_key" ON "ModuleConsultant" ("moduleId", track, rank);
CREATE INDEX IF NOT EXISTS "ModuleConsultant_userId_idx" ON "ModuleConsultant" ("userId");
