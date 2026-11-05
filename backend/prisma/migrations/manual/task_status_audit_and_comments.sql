-- Ticket screen: status-change audit, task comments, Time folded into Tasks.
--
-- 1. A task's manual clock (Start button -> startedAt, typed endedAt, auto
--    worklog) is replaced by a timestamped trail of its status changes. Time
--    spent is the sum of the intervals the task stood in IN_PROGRESS, and it is
--    AUDIT ONLY -- it books no TicketWorklog and is never charged to the
--    support-hours pool. Billable time is logged by hand on the Tasks tab.
-- 2. Comments arrive on both the ticket and its tasks, in one table.
-- 3. The ticket carries the stamp of its last status change.
--
-- Worklogs that past tasks created (note 'Task: <title>') are deliberately left
-- alone: they are real hours already charged to the customer's pool.
--
-- Idempotent: safe to re-run. Step 4's backfill is guarded on the old columns
-- still existing, so a second run after step 5 drops them is a no-op.

-- 1. Per-task status trail.
CREATE TABLE IF NOT EXISTS "TicketTaskStatusEvent" (
  "id"          TEXT NOT NULL,
  "taskId"      TEXT NOT NULL,
  "ticketId"    TEXT NOT NULL,
  "fromStatus"  TEXT,
  "toStatus"    TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorName"   TEXT,
  "at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketTaskStatusEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TicketTaskStatusEvent_taskId_at_idx"   ON "TicketTaskStatusEvent" ("taskId", "at");
CREATE INDEX IF NOT EXISTS "TicketTaskStatusEvent_ticketId_at_idx" ON "TicketTaskStatusEvent" ("ticketId", "at");

DO $$
BEGIN
  ALTER TABLE "TicketTaskStatusEvent"
    ADD CONSTRAINT "TicketTaskStatusEvent_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "TicketTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Comments on a ticket and on its tasks. taskId NULL = ticket-level.
CREATE TABLE IF NOT EXISTS "TicketComment" (
  "id"           TEXT NOT NULL,
  "ticketId"     TEXT NOT NULL,
  "taskId"       TEXT,
  "authorUserId" TEXT,
  "authorName"   TEXT,
  "body"         TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TicketComment_ticketId_createdAt_idx" ON "TicketComment" ("ticketId", "createdAt");
CREATE INDEX IF NOT EXISTS "TicketComment_taskId_createdAt_idx"   ON "TicketComment" ("taskId", "createdAt");

DO $$
BEGIN
  ALTER TABLE "TicketComment"
    ADD CONSTRAINT "TicketComment_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "TicketComment"
    ADD CONSTRAINT "TicketComment_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "TicketTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. When the ticket's status last changed.
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "statusChangedAt" TIMESTAMP(3);

-- 4. Backfill the trail from the clock we are about to drop, so no existing task
--    loses its timeline. A started task gets an OPEN -> IN_PROGRESS event at its
--    start stamp; an ended one also gets an IN_PROGRESS -> <current status> event
--    at its end stamp. Guarded on the columns still being present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'TicketTask' AND column_name = 'startedAt'
  ) THEN
    INSERT INTO "TicketTaskStatusEvent" ("id", "taskId", "ticketId", "fromStatus", "toStatus", "actorUserId", "at")
    SELECT gen_random_uuid()::text, t."id", t."ticketId", 'OPEN', 'IN_PROGRESS', t."assigneeUserId", t."startedAt"
    FROM "TicketTask" t
    WHERE t."startedAt" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "TicketTaskStatusEvent" e WHERE e."taskId" = t."id");

    INSERT INTO "TicketTaskStatusEvent" ("id", "taskId", "ticketId", "fromStatus", "toStatus", "actorUserId", "at")
    SELECT gen_random_uuid()::text, t."id", t."ticketId", 'IN_PROGRESS',
           CASE WHEN t."status" = 'IN_PROGRESS' THEN 'DONE' ELSE t."status" END,
           t."assigneeUserId", t."endedAt"
    FROM "TicketTask" t
    WHERE t."startedAt" IS NOT NULL AND t."endedAt" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "TicketTaskStatusEvent" e
        WHERE e."taskId" = t."id" AND e."fromStatus" = 'IN_PROGRESS'
      );
  END IF;
END $$;

-- 5. The clock itself is gone. hoursSpent stays, but now means "time in progress,
--    derived from the trail above".
ALTER TABLE "TicketTask"
  DROP COLUMN IF EXISTS "startedAt",
  DROP COLUMN IF EXISTS "endedAt",
  DROP COLUMN IF EXISTS "worklogId";
