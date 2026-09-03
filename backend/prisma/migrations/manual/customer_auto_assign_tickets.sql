-- Per-client gate on ticket auto-routing. Off = every ticket the client raises
-- lands unassigned for a manager to pick. Applies whatever the contractScope is,
-- which is why it carries no contract* prefix. Defaults to TRUE so existing
-- clients keep today's behaviour.
ALTER TABLE "CustomerCompany"
  ADD COLUMN IF NOT EXISTS "autoAssignTickets" BOOLEAN NOT NULL DEFAULT true;
