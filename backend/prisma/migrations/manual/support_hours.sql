-- Agreed support-hours pool per customer company + per-ticket worklog time tracking.

ALTER TABLE "CustomerCompany"
  ADD COLUMN IF NOT EXISTS "agreedSupportHours" DECIMAL,
  ADD COLUMN IF NOT EXISTS "supportPeriodStart" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "supportPeriodEnd" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "supportAlertThresholdPct" INTEGER NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS "supportAlertSentAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "TicketWorklog" (
  "id"             TEXT PRIMARY KEY,
  "clientId"       TEXT NOT NULL,
  "ticketId"       TEXT NOT NULL REFERENCES "Ticket"("id") ON DELETE CASCADE,
  "userId"         TEXT,
  "consultantName" TEXT,
  "workDate"       TIMESTAMP(3) NOT NULL,
  "hours"          DECIMAL NOT NULL,
  "note"           TEXT,
  "createdBy"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "TicketWorklog_ticketId_idx" ON "TicketWorklog"("ticketId");
CREATE INDEX IF NOT EXISTS "TicketWorklog_clientId_workDate_idx" ON "TicketWorklog"("clientId", "workDate");
