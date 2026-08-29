-- Change Management: a change is either raised for a customer company (CUSTOMER —
-- the customer admin approves it) or an internal one (INTERNAL — no customer at all).
-- Idempotent: safe to re-run.
ALTER TABLE "ChangeRequest"
  ADD COLUMN IF NOT EXISTS "changeSource" TEXT NOT NULL DEFAULT 'CUSTOMER';

-- Existing rows with no linked company were internal in all but name. Clear the
-- denormalised customer text with them, or the record names a customer it has
-- no link to.
UPDATE "ChangeRequest"
   SET "changeSource" = 'INTERNAL', "customer" = NULL
 WHERE "customerCompanyId" IS NULL
   AND "changeSource" = 'CUSTOMER';

-- Re-running catches rows already flipped by an earlier pass.
UPDATE "ChangeRequest"
   SET "customer" = NULL
 WHERE "changeSource" = 'INTERNAL'
   AND "customer" IS NOT NULL;
