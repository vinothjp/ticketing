-- Template.isDefault: the template the New Ticket form opens on. At most one
-- per tenant (enforced in TemplatesService, not by an index — `db push` would
-- drop a hand-added partial index). Idempotent: safe to re-run.
ALTER TABLE "Template" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;
