-- Optional link from a logged time entry to the task it was spent on, offered as
-- a field in the Log time dialog on the Tasks tab.
--
-- SetNull rather than Cascade: the hours were really spent and stay charged to
-- the customer's pool even if the task is deleted later, so `taskTitle` is
-- denormalised beside the id (same habit as consultantName) and the entry keeps
-- saying what it was for.
--
-- Idempotent: safe to re-run.

ALTER TABLE "TicketWorklog" ADD COLUMN IF NOT EXISTS "taskId"    TEXT;
ALTER TABLE "TicketWorklog" ADD COLUMN IF NOT EXISTS "taskTitle" TEXT;

CREATE INDEX IF NOT EXISTS "TicketWorklog_taskId_idx" ON "TicketWorklog" ("taskId");

DO $$
BEGIN
  ALTER TABLE "TicketWorklog"
    ADD CONSTRAINT "TicketWorklog_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "TicketTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
