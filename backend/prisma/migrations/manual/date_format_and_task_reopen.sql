-- Tenant-wide date format, chosen on the Organization screen from the
-- DATE_FORMAT option list and applied to every date the ticket screens render.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "dateFormat" TEXT NOT NULL DEFAULT 'dd/MM/yyyy';

-- Why a completed task was reopened. Only that transition demands it, so every
-- other status event leaves it null.
ALTER TABLE "TicketTaskStatusEvent" ADD COLUMN IF NOT EXISTS "note" TEXT;
