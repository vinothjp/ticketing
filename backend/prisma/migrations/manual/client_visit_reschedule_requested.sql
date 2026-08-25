-- Split the single RESCHEDULED status into two states:
--   RESCHEDULE_REQUESTED = the consultant asked, still waiting on an admin date
--   PLANNED + rescheduleCount > 0 = an admin gave it a new date; it is on the
--   calendar again but is marked as having been rescheduled.
-- Idempotent: safe to re-run.
ALTER TABLE "ClientLog"
  ADD COLUMN IF NOT EXISTS "rescheduleCount" INTEGER NOT NULL DEFAULT 0;

-- Existing rows sitting on the old value are all "awaiting a new date".
UPDATE "ClientLog" SET status = 'RESCHEDULE_REQUESTED' WHERE status = 'RESCHEDULED';
