-- People are named by full name, not username — a username is often an employee
-- id (client request). These three columns hold a name written at the time, so
-- rows from before the change still carry the username. Rewrite only a value
-- that is still exactly that person's username, and only when they have a full
-- name: idempotent (a re-run reports UPDATE 0) and never touches a name someone
-- typed or one already rewritten.

-- Ticket requester of record (client-raised tickets stored the username).
UPDATE "Ticket" t
SET "requestorName" = trim(u."name")
FROM "User" u
WHERE u."id" = t."requestorUserId"
  AND nullif(trim(u."name"), '') IS NOT NULL
  AND t."requestorName" = u."username";

-- Client visit consultant (model ClientVisit, table still ClientLog).
UPDATE "ClientLog" v
SET "consultantName" = trim(u."name")
FROM "User" u
WHERE u."id" = v."consultantId"
  AND nullif(trim(u."name"), '') IS NOT NULL
  AND v."consultantName" = u."username";

-- Change request "Raised by".
UPDATE "ChangeRequest" c
SET "createdByName" = trim(u."name")
FROM "User" u
WHERE u."id" = c."createdBy"
  AND nullif(trim(u."name"), '') IS NOT NULL
  AND c."createdByName" = u."username";
