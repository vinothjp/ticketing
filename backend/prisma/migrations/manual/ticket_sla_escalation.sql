-- Ticket.slaEscalatedFor: the due date the SLA-breach escalation email was sent
-- for (TicketsService.escalateBreachedSla, hourly). One email per breach; a new
-- due date arms it again.
--
-- The column and the marking of the existing backlog happen together, only when
-- the column is first added: every ticket already past its due date when this
-- ships counts as escalated, so the first sweep does not mail the whole backlog
-- (agreed — only tickets breaching from now on escalate). Re-running this file
-- never re-marks a ticket. Apply it BEFORE the backend restarts on the new
-- schema: `prisma db push` would otherwise add the column itself and the
-- marking below would be skipped.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Ticket' AND column_name = 'slaEscalatedFor'
  ) THEN
    ALTER TABLE "Ticket" ADD COLUMN "slaEscalatedFor" TIMESTAMP(3);
    UPDATE "Ticket" SET "slaEscalatedFor" = "dueDate" WHERE "dueDate" IS NOT NULL AND "dueDate" < now();
  END IF;
END $$;
