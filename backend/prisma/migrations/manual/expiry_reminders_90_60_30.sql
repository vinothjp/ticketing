-- AMC / warranty / shared-contract expiry reminders go out 90, 60 and 30 days
-- before the end date instead of once at 30. Each contract remembers which
-- reminder it was last sent (expiryReminderDays / contractExpiryReminderDays);
-- the sweep sends the next one once its window is reached.
--
-- Backfill: a contract already warned about its *current* end date under the old
-- single 30-day rule has had the 30-day reminder, so it is marked 30 and nothing
-- is resent. Self-contained — it does not depend on contract_expiry_alert_marker.sql
-- having run first. Idempotent: re-running only fills markers still empty.

ALTER TABLE "CustomerCompanyProduct" ADD COLUMN IF NOT EXISTS "expiryReminderDays" INTEGER;
ALTER TABLE "CustomerCompany"        ADD COLUMN IF NOT EXISTS "contractExpiryReminderDays" INTEGER;
-- Also added by contract_expiry_alert_marker.sql; repeated so this file runs on its own.
ALTER TABLE "CustomerCompany"        ADD COLUMN IF NOT EXISTS "contractExpiryAlertSentAt" TIMESTAMP(3);

-- Per product: the old marker was set when the 30-day warning went out.
UPDATE "CustomerCompanyProduct"
SET "expiryReminderDays" = 30
WHERE "expiryReminderDays" IS NULL
  AND "expiryAlertSentAt" IS NOT NULL
  AND "amcEnd" IS NOT NULL
  AND "expiryAlertSentAt" >= "amcEnd" - INTERVAL '31 days';

-- Shared contracts: read off the expiry notifications actually sent to the
-- client's people, since the old marker was shared with the hours-low alert.
UPDATE "CustomerCompany" c
SET "contractExpiryReminderDays" = 30,
    "contractExpiryAlertSentAt"  = COALESCE(c."contractExpiryAlertSentAt", sent.at)
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
  AND c."contractExpiryReminderDays" IS NULL
  AND sent.at >= c."contractEnd" - INTERVAL '31 days'
  AND sent.at <= c."contractEnd";
