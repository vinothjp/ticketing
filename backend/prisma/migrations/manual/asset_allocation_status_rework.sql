-- Asset allocation: two statuses, a return condition, a retention mode, and an
-- audit trail.
--
-- The register shipped with four allocation statuses, two of which were not
-- statuses at all. BROKEN described the *unit*, not where the allocation stood,
-- and NOT_RETURNED described a circumstance. Both meant the same thing about the
-- allocation itself: the asset is still out with the employee. So:
--
--   * "AssetAllocation"."status"          -> ISSUED | RETURNED only
--   * "AssetAllocation"."returnCondition" -> GOOD | BROKEN, how it came back
--   * "Asset"."condition"                 -> OK | DAMAGED | RETIRED, the unit's own
--     state, which outlives any one allocation and can be cleared once repaired
--   * "AssetAllocation"."retention"       -> RETURNABLE | UNTIL_EXIT, for the
--     phone/laptop an employee keeps until they leave
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------------
ALTER TABLE "Asset" ADD COLUMN IF NOT EXISTS "condition" TEXT NOT NULL DEFAULT 'OK';

ALTER TABLE "AssetAllocation" ADD COLUMN IF NOT EXISTS "returnCondition"    TEXT;
ALTER TABLE "AssetAllocation" ADD COLUMN IF NOT EXISTS "retention"          TEXT NOT NULL DEFAULT 'RETURNABLE';
ALTER TABLE "AssetAllocation" ADD COLUMN IF NOT EXISTS "expectedReturnDate" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 2. Audit trail
--
-- "allocationId" is deliberately a plain column with no foreign key: removing an
-- allocation is exactly the event this table exists to record, so it must not
-- cascade the history away with it. The asset FK does cascade — deleting the
-- unit removes it from the register entirely.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "AssetActivity" (
  "id"             TEXT PRIMARY KEY,
  "clientId"       TEXT NOT NULL,
  "assetId"        TEXT NOT NULL,
  "allocationId"   TEXT,
  "employeeUserId" TEXT,
  "employeeName"   TEXT,
  "type"           TEXT NOT NULL,
  "summary"        TEXT NOT NULL,
  "meta"           JSONB,
  "actorUserId"    TEXT,
  "actorName"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssetActivity_assetId_fkey') THEN
    ALTER TABLE "AssetActivity" ADD CONSTRAINT "AssetActivity_assetId_fkey"
      FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "AssetActivity_clientId_assetId_createdAt_idx"
  ON "AssetActivity" ("clientId", "assetId", "createdAt");
CREATE INDEX IF NOT EXISTS "AssetActivity_clientId_employeeUserId_createdAt_idx"
  ON "AssetActivity" ("clientId", "employeeUserId", "createdAt");

-- ---------------------------------------------------------------------------
-- 3. Backfill the two retired statuses
--
-- Both said the unit was still with the employee, so both become ISSUED. What
-- each one additionally meant is preserved in its proper home.
-- ---------------------------------------------------------------------------

-- BROKEN: the unit is damaged and still out. The damage belongs to the asset.
UPDATE "Asset" a
   SET "condition" = 'DAMAGED'
 WHERE a."condition" = 'OK'
   AND EXISTS (
     SELECT 1 FROM "AssetAllocation" al
      WHERE al."assetId" = a."id" AND al."status" = 'BROKEN'
   );

UPDATE "AssetAllocation"
   SET "status" = 'ISSUED'
 WHERE "status" = 'BROKEN';

-- NOT_RETURNED: the employee failed to hand it back. That is an overdue
-- returnable allocation, so give it a due date already in the past — which is
-- what the old status was really saying.
UPDATE "AssetAllocation"
   SET "status"             = 'ISSUED',
       "retention"          = 'RETURNABLE',
       "expectedReturnDate" = COALESCE("issuedDate", "createdAt"),
       "notes"              = COALESCE("notes" || ' ', '') || '[migrated from Not returned]'
 WHERE "status" = 'NOT_RETURNED';

-- Every already-returned row came back in one piece as far as anyone recorded,
-- so no returned allocation reads as unknown.
UPDATE "AssetAllocation"
   SET "returnCondition" = 'GOOD'
 WHERE "status" = 'RETURNED' AND "returnCondition" IS NULL;
