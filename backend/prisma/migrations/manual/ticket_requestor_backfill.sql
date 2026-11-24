-- Staff-raised tickets with no requester named read "Requester: —". New ones now
-- record the raiser as the requester (name only); this back-fills existing ones
-- the same way. Idempotent: only touches rows whose requester name AND email are
-- both still empty and whose creator is an internal staff user.
UPDATE "Ticket" t
SET "requestorName" = COALESCE(NULLIF(TRIM(u."name"), ''), u."username")
FROM "User" u
WHERE u."id" = t."createdBy"
  AND u."customerCompanyId" IS NULL
  AND COALESCE(TRIM(t."requestorName"), '') = ''
  AND COALESCE(TRIM(t."requestorEmail"), '') = '';
