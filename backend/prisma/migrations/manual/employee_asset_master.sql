-- Employee Master + Asset Master.
--
-- Employees are the existing internal staff, so the employee record is five new
-- columns on "User" rather than a second person table. Assets are a new register
-- of individual units, allocated to those users, and a ticket approval can now
-- name the asset it is a request for.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Employee fields on "User"
-- ---------------------------------------------------------------------------
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "employeeId"  TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "department"  TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "designation" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone"       TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "managerId"   TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_managerId_fkey') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey"
      FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- NULLs are distinct in Postgres, so staff without an employee id never collide.
CREATE UNIQUE INDEX IF NOT EXISTS "User_clientId_employeeId_key" ON "User" ("clientId", "employeeId");
CREATE INDEX IF NOT EXISTS "User_managerId_idx" ON "User" ("managerId");

-- ---------------------------------------------------------------------------
-- 2. Asset register
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Asset" (
  "id"            TEXT PRIMARY KEY,
  "clientId"      TEXT NOT NULL,
  "assetId"       TEXT NOT NULL,
  "assetName"     TEXT NOT NULL,
  "description"   TEXT,
  "assetType"     TEXT,
  "assetCategory" TEXT,
  "serialNumber"  TEXT,
  "manufacturer"  TEXT,
  "model"         TEXT,
  "barcode"       TEXT,
  "warrantyStart" TIMESTAMP(3),
  "warrantyEnd"   TIMESTAMP(3),
  "purchaseDate"  TIMESTAMP(3),
  "poNumber"      TEXT,
  "supplierName"  TEXT,
  "invoiceNumber" TEXT,
  "lifespan"      TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"     TEXT,
  "updatedBy"     TEXT
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Asset_clientId_fkey') THEN
    ALTER TABLE "Asset" ADD CONSTRAINT "Asset_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Asset_clientId_assetId_key" ON "Asset" ("clientId", "assetId");
CREATE INDEX IF NOT EXISTS "Asset_clientId_idx" ON "Asset" ("clientId");

-- ---------------------------------------------------------------------------
-- 3. Asset allocations
--
-- The "one holder at a time" rule (at most one allocation per asset whose status
-- is not RETURNED) is enforced in AssetAllocationsService, not by a partial
-- unique index here: the backend container runs `prisma db push
-- --accept-data-loss` on start, and would drop an index schema.prisma cannot
-- express.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "AssetAllocation" (
  "id"             TEXT PRIMARY KEY,
  "clientId"       TEXT NOT NULL,
  "assetId"        TEXT NOT NULL,
  "employeeUserId" TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'ISSUED',
  "issuedDate"     TIMESTAMP(3),
  "returnDate"     TIMESTAMP(3),
  "notes"          TEXT,
  "assetCode"      TEXT,
  "assetName"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"      TEXT,
  "updatedBy"      TEXT
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssetAllocation_clientId_fkey') THEN
    ALTER TABLE "AssetAllocation" ADD CONSTRAINT "AssetAllocation_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssetAllocation_assetId_fkey') THEN
    ALTER TABLE "AssetAllocation" ADD CONSTRAINT "AssetAllocation_assetId_fkey"
      FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssetAllocation_employeeUserId_fkey') THEN
    ALTER TABLE "AssetAllocation" ADD CONSTRAINT "AssetAllocation_employeeUserId_fkey"
      FOREIGN KEY ("employeeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "AssetAllocation_clientId_employeeUserId_idx" ON "AssetAllocation" ("clientId", "employeeUserId");
CREATE INDEX IF NOT EXISTS "AssetAllocation_assetId_idx" ON "AssetAllocation" ("assetId");

-- ---------------------------------------------------------------------------
-- 4. A ticket approval is now an asset request
-- ---------------------------------------------------------------------------
ALTER TABLE "TicketApproval" ADD COLUMN IF NOT EXISTS "assetId"   TEXT;
ALTER TABLE "TicketApproval" ADD COLUMN IF NOT EXISTS "assetCode" TEXT;
ALTER TABLE "TicketApproval" ADD COLUMN IF NOT EXISTS "assetName" TEXT;
ALTER TABLE "TicketApproval" ADD COLUMN IF NOT EXISTS "assetType" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TicketApproval_assetId_fkey') THEN
    ALTER TABLE "TicketApproval" ADD CONSTRAINT "TicketApproval_assetId_fkey"
      FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TicketApproval_assetId_idx" ON "TicketApproval" ("assetId");
