-- CAB approver identity fix + staff full-name field.
-- Idempotent: safe to re-run.

-- Staff users gain an optional full display name (e.g. "John Rivera").
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "name" TEXT;

-- A change request's CAB approver is now a real staff user identity. The existing
-- "changeApprover" text column is kept as the denormalised display name.
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "changeApproverUserId" TEXT;
