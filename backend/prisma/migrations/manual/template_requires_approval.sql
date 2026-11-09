-- Template.requiresApproval: tickets agents and customers raise on the template
-- wait for a tenant Admin's approval before anyone can work on them.
--
-- The column and the one-off switch-on for existing change-request templates
-- happen together, only when the column is first added, so re-running this
-- file never re-ticks a box an admin has since turned off. Apply it BEFORE the
-- backend restarts on the new schema: `prisma db push` would otherwise add the
-- column itself and the switch-on below would be skipped.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Template' AND column_name = 'requiresApproval'
  ) THEN
    ALTER TABLE "Template" ADD COLUMN "requiresApproval" BOOLEAN NOT NULL DEFAULT false;
    UPDATE "Template" SET "requiresApproval" = true WHERE "category" = 'Change';
  END IF;
END $$;
