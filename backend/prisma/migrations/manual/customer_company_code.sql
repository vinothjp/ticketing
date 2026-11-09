-- Client "Company code": an auto-generated id per client (CC-000001), handed out
-- from a per-tenant counter like ticket / CR / client-visit numbers. The old
-- admin-typed `code` stays as it is and is labelled "Short name" in the UI.
--
-- Idempotent: columns and index are IF NOT EXISTS, the back-fill only numbers
-- clients that have no code yet (continuing after the tenant's counter), and the
-- counter is only ever raised. Run before the backend restarts on the new schema.

ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "companySequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "companyCode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerCompany_clientId_companyCode_key"
  ON "CustomerCompany"("clientId", "companyCode");

-- Existing clients, numbered in the order they were created.
WITH numbered AS (
  SELECT cc."id", cc."clientId",
         c."companySequence" + ROW_NUMBER() OVER (PARTITION BY cc."clientId" ORDER BY cc."createdAt", cc."id") AS n
  FROM "CustomerCompany" cc
  JOIN "Client" c ON c."id" = cc."clientId"
  WHERE cc."companyCode" IS NULL
)
UPDATE "CustomerCompany" cc
SET "companyCode" = 'CC-' || LPAD(numbered.n::text, 6, '0')
FROM numbered
WHERE cc."id" = numbered."id";

-- The counter carries on after the highest number handed out.
UPDATE "Client" c
SET "companySequence" = sub.maxn
FROM (
  SELECT "clientId", MAX(SUBSTRING("companyCode" FROM 4)::int) AS maxn
  FROM "CustomerCompany"
  WHERE "companyCode" ~ '^CC-[0-9]+$'
  GROUP BY "clientId"
) sub
WHERE c."id" = sub."clientId" AND c."companySequence" < sub.maxn;
