-- Rev 2: per-stage status notes on a change request, keyed by stage name.
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "stageNotes" JSONB;
