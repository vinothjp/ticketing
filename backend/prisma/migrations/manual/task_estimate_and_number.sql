-- Ticket tasks: a per-ticket task number and an estimate.
--
-- The Tasks grid went back to the earlier design — no Start/Stop timer — so time
-- is entered on the task's own edit screen when its status moves, prefilled from
-- the estimate typed when the task was raised. Both columns are additive; the
-- backfill numbers the rows that predate `taskNumber` in the order the grid
-- already shows them, so an existing ticket reads T-001, T-002, … from the top.
--
-- Idempotent: re-running adds nothing and renumbers nothing (the UPDATE is
-- confined to rows still NULL).

ALTER TABLE "TicketTask"
  ADD COLUMN IF NOT EXISTS "taskNumber"     INTEGER,
  ADD COLUMN IF NOT EXISTS "estimatedHours" DECIMAL(65,30);

UPDATE "TicketTask" t
SET "taskNumber" = n.rn
FROM (
  SELECT id,
         row_number() OVER (PARTITION BY "ticketId" ORDER BY "sortOrder", "createdAt") AS rn
  FROM "TicketTask"
) n
WHERE n.id = t.id AND t."taskNumber" IS NULL;
