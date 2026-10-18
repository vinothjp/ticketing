-- Freeze the cost/billing rate on every project timesheet row, so past hours keep
-- the rate they were logged at when a Resource Cost rate, a member's category or
-- the Resources plan itself changes later.
ALTER TABLE "ProjectTimesheet" ADD COLUMN IF NOT EXISTS "costRate" DECIMAL(65,30);
ALTER TABLE "ProjectTimesheet" ADD COLUMN IF NOT EXISTS "billingRate" DECIMAL(65,30);

-- Backfill rows written before the snapshot existed. There is no rate history, so
-- today's rate from the consultant's resource row on that project is the best
-- available. Idempotent: only rows still unstamped are touched, and a row whose
-- consultant has no costed resource row stays NULL (costed at 0, as before).
UPDATE "ProjectTimesheet" t
SET "costRate" = r."hourlyCost", "billingRate" = r."billingRate"
FROM (
  SELECT DISTINCT ON (pr."projectId", pr."userId")
    pr."projectId", pr."userId", c."hourlyCost", c."billingRate"
  FROM "ProjectResource" pr
  JOIN "ResourceCategory" c ON c.id = pr."categoryId"
  WHERE pr."userId" IS NOT NULL
  ORDER BY pr."projectId", pr."userId", pr."createdAt" DESC
) r
WHERE t."costRate" IS NULL
  AND t."projectId" = r."projectId"
  AND t."userId" = r."userId";
