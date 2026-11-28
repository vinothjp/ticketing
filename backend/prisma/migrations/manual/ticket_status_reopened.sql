-- A reopened ticket gets its own status, "Reopened" (client request), so it can be
-- filtered and counted apart from fresh work. TicketsService.reopenedStatus adds the
-- value on first use too; this file only makes it show everywhere straight away.
-- Idempotent: re-running inserts nothing and updates nothing.

-- 1. Every tenant that has a Ticket Status list gets the value, just after its first
--    status (never before it — new tickets take the first one).
INSERT INTO "PicklistOption" (id, "clientId", "listKey", value, label, "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."clientId", 'ticketStatus', 'Reopened', 'Reopened', MIN(p."sortOrder") + 1, true, NOW(), NOW()
FROM "PicklistOption" p
WHERE p."listKey" = 'ticketStatus'
GROUP BY p."clientId"
ON CONFLICT ("clientId", "listKey", value) DO NOTHING;

-- 2. Tickets reopened before this existed and not touched since: still unresolved and
--    their last status change is the reopen itself (both stamped in the same update).
--    One moved on to another status since keeps it.
UPDATE "Ticket" t
SET "ticketStatus" = 'Reopened'
WHERE t."reopenedAt" IS NOT NULL
  AND t."resolvedAt" IS NULL
  AND t."ticketStatus" <> 'Reopened'
  AND t."statusChangedAt" BETWEEN t."reopenedAt" - INTERVAL '5 seconds' AND t."reopenedAt" + INTERVAL '5 seconds'
  AND EXISTS (
    SELECT 1 FROM "PicklistOption" p
    WHERE p."clientId" = t."clientId" AND p."listKey" = 'ticketStatus' AND p.value = 'Reopened' AND p."isActive"
  );
