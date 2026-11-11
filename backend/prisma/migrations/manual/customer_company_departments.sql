-- Per-client department allow-list for the New Ticket form's Department field.
-- Holds PicklistOption values of listKey 'department'; empty = every department,
-- so existing clients are unaffected. Idempotent; no back-fill.
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "departments" TEXT[] DEFAULT ARRAY[]::TEXT[];
