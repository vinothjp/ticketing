-- New clients start with ticket auto-assignment OFF (client request): it is
-- switched on only when the customer asks for it. Only the column default
-- changes — every existing client keeps the value it has. Idempotent, and a
-- no-op until customer_auto_assign_tickets.sql has added the column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'CustomerCompany' AND column_name = 'autoAssignTickets'
  ) THEN
    ALTER TABLE "CustomerCompany" ALTER COLUMN "autoAssignTickets" SET DEFAULT false;
  END IF;
END $$;
