-- Backfill the asset audit trail from the records that already exist.
--
-- `AssetActivity` was added after the register was already in use, so every asset
-- and allocation predating it had no history at all. Nothing here is invented:
-- each entry is derived from a real row's own stored timestamps and actor
-- columns, and carries `meta->>'backfilled' = 'true'` so a reconstructed entry is
-- always distinguishable from one written live by the service.
--
-- **Every entry is stamped when the event was *recorded*, never at the business
-- date it refers to.** An allocation's `issuedDate` is when the laptop was
-- physically handed over — often months before anyone typed it in — so stamping
-- the entry with it produced trails reading "issued 12/03, added to the register
-- 29/08": an effect before its cause. `createdAt` is the honest stamp, and since
-- an allocation row can only be written after its asset row, causal order then
-- holds by construction. The business dates are kept in `meta`, and are on the
-- allocation grid directly above this trail on both screens.
--
-- It also clears the table first, which removes any entry written against the
-- retired four-status vocabulary (a summary naming "Broken" or "Not returned" as
-- a *status* would now be describing a state the model no longer has).
--
-- Idempotent: re-running rebuilds the same trail from the same rows.

-- ---------------------------------------------------------------------------
-- 1. Clear anything from the old logic, and any earlier run of this backfill
-- ---------------------------------------------------------------------------
DELETE FROM "AssetActivity";

-- ---------------------------------------------------------------------------
-- 2. One ASSET_CREATED per asset, stamped when the asset row was written
-- ---------------------------------------------------------------------------
INSERT INTO "AssetActivity" (
  "id", "clientId", "assetId", "type", "summary", "meta",
  "actorUserId", "actorName", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  a."clientId",
  a."id",
  'ASSET_CREATED',
  'Added ' || a."assetId" || ' — ' || a."assetName" || ' to the register',
  '{"backfilled": true}'::jsonb,
  a."createdBy",
  COALESCE(u."name", u."username"),
  a."createdAt"
FROM "Asset" a
LEFT JOIN "User" u ON u."id" = a."createdBy";

-- ---------------------------------------------------------------------------
-- 3. One ALLOCATED per allocation, stamped when the allocation was recorded
--
-- `retention` is read off the row, so a unit already marked "until exit" says so
-- in its history rather than reading as an ordinary issue. The issue date itself
-- goes to `meta` — it is a business fact, not the time this was recorded.
-- ---------------------------------------------------------------------------
INSERT INTO "AssetActivity" (
  "id", "clientId", "assetId", "allocationId", "employeeUserId", "employeeName",
  "type", "summary", "meta", "actorUserId", "actorName", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  al."clientId",
  al."assetId",
  al."id",
  al."employeeUserId",
  COALESCE(e."name", e."username"),
  'ALLOCATED',
  'Issued to ' || COALESCE(e."name", e."username", 'the employee')
    || CASE WHEN al."retention" = 'UNTIL_EXIT' THEN ' · until exit' ELSE '' END,
  jsonb_build_object(
    'backfilled', true,
    'retention', al."retention",
    'status', 'ISSUED',
    'issuedDate', al."issuedDate"
  ),
  al."createdBy",
  COALESCE(c."name", c."username"),
  -- Belt and braces: an allocation cannot predate its own asset, so clamp to
  -- just after the asset entry even if the stored timestamps disagree.
  GREATEST(al."createdAt", a."createdAt" + interval '1 second')
FROM "AssetAllocation" al
JOIN "Asset" a ON a."id" = al."assetId"
LEFT JOIN "User" e ON e."id" = al."employeeUserId"
LEFT JOIN "User" c ON c."id" = al."createdBy";

-- ---------------------------------------------------------------------------
-- 4. A RETURNED entry for every allocation that has come back, stamped at the
--    last write to the row — and never at or before its own ALLOCATED entry.
-- ---------------------------------------------------------------------------
INSERT INTO "AssetActivity" (
  "id", "clientId", "assetId", "allocationId", "employeeUserId", "employeeName",
  "type", "summary", "meta", "actorUserId", "actorName", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  al."clientId",
  al."assetId",
  al."id",
  al."employeeUserId",
  COALESCE(e."name", e."username"),
  'RETURNED',
  'Returned by ' || COALESCE(e."name", e."username", 'the employee')
    || ' — ' || CASE WHEN al."returnCondition" = 'BROKEN' THEN 'Broken' ELSE 'Good' END,
  jsonb_build_object(
    'backfilled', true,
    'returnCondition', COALESCE(al."returnCondition", 'GOOD'),
    'returnDate', al."returnDate"
  ),
  al."updatedBy",
  COALESCE(c."name", c."username"),
  GREATEST(
    al."updatedAt",
    GREATEST(al."createdAt", a."createdAt" + interval '1 second') + interval '1 second'
  )
FROM "AssetAllocation" al
JOIN "Asset" a ON a."id" = al."assetId"
LEFT JOIN "User" e ON e."id" = al."employeeUserId"
LEFT JOIN "User" c ON c."id" = al."updatedBy"
WHERE al."status" = 'RETURNED';

-- ---------------------------------------------------------------------------
-- 5. A CONDITION_CHANGED entry for every unit not in OK condition
--
-- These are the assets the status rework moved from a BROKEN allocation onto the
-- unit itself, so the trail says where that DAMAGED flag came from rather than
-- leaving it unexplained on the asset form.
--
-- Stamped after everything else on that unit: the damage was done *during* an
-- allocation, so it cannot read as predating it. The asset's own `updatedAt` is
-- no help here — the status rework moved these flags with raw SQL, which does not
-- bump Prisma's client-side `@updatedAt`, so the column still holds the seed
-- timestamp.
-- ---------------------------------------------------------------------------
INSERT INTO "AssetActivity" (
  "id", "clientId", "assetId", "type", "summary", "meta",
  "actorUserId", "actorName", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  a."clientId",
  a."id",
  'CONDITION_CHANGED',
  'Condition OK → ' || CASE WHEN a."condition" = 'RETIRED' THEN 'Retired' ELSE 'Damaged' END,
  jsonb_build_object('backfilled', true, 'from', 'OK', 'to', a."condition"),
  NULL,
  NULL,
  GREATEST(
    a."updatedAt",
    COALESCE(
      (SELECT max(ev."createdAt") FROM "AssetActivity" ev WHERE ev."assetId" = a."id"),
      a."createdAt"
    ) + interval '1 second'
  )
FROM "Asset" a
WHERE a."condition" <> 'OK';
