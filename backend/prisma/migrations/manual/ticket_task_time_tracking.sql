-- Ticket task time tracking (items 10/11).
--
-- A task assigned to a consultant gets a Start button that server-stamps
-- `startedAt`; the consultant then enters `endedAt`, and the system derives
-- `hoursSpent` = (endedAt - startedAt).
--
-- Those hours are charged through the existing TicketWorklog path — that
-- aggregate is what every support-hours screen reads — so `worklogId` records
-- which row this task produced, letting an edit correct exactly that entry
-- instead of double-counting (same bookkeeping idea as ClientVisit.deductedCpId).
--
-- Idempotent: safe to re-run.

ALTER TABLE "TicketTask" ADD COLUMN IF NOT EXISTS "startedAt"  TIMESTAMP(3);
ALTER TABLE "TicketTask" ADD COLUMN IF NOT EXISTS "endedAt"    TIMESTAMP(3);
ALTER TABLE "TicketTask" ADD COLUMN IF NOT EXISTS "hoursSpent" DECIMAL(65,30);
ALTER TABLE "TicketTask" ADD COLUMN IF NOT EXISTS "worklogId"  TEXT;
