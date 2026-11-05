-- The shared customer contract's expiry warning gets its own "sent" marker.
-- It used to share CustomerCompany.contractAlertSentAt with the "support hours
-- running low" alert, so whichever fired first silently suppressed the other —
-- a client whose hours ran low never got told their contract was ending.
--
-- Backfill: a contract that has already been warned about its *current* end date
-- (an expiry notification sent to that client's people within the 31 days before
-- it) is marked, so deploying this doesn't send the same warning twice. Everyone
-- else starts unmarked and is warned on the next sweep if inside the window.
-- Idempotent: re-running adds nothing and only fills markers still empty.

ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "contractExpiryAlertSentAt" TIMESTAMP(3);

UPDATE "CustomerCompany" c
SET "contractExpiryAlertSentAt" = sent.at
FROM (
  SELECT u."customerCompanyId" AS id, max(n."createdAt") AS at
  FROM "Notification" n
  JOIN "User" u ON u.id = n."userId"
  WHERE n.type = 'CONTRACT'
    AND n.title LIKE 'Your % ends in % day(s)'
    AND u."customerCompanyId" IS NOT NULL
  GROUP BY u."customerCompanyId"
) sent
WHERE c.id = sent.id
  AND c."contractScope" = 'CUSTOMER'
  AND c."contractEnd" IS NOT NULL
  AND c."contractExpiryAlertSentAt" IS NULL
  AND sent.at >= c."contractEnd" - INTERVAL '31 days'
  AND sent.at <= c."contractEnd";
