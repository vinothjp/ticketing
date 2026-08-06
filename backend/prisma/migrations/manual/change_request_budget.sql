-- Migration: change_request_budget — link WBS tasks to Change Requests + budget-revision fields
-- (applied automatically by `prisma db push` on backend start; kept here for parity/audit)

-- Change Request: cost of the change (auto-suggested from linked tasks, overridable).
ALTER TABLE "ProjectChangeRequest" ADD COLUMN IF NOT EXISTS "costEstimate" DECIMAL(65,30);
-- "budgetImpact" already exists; it now means the approved budget increase applied on approval.

-- ProjectTask: the Change Request that introduced this task (SetNull on CR delete).
ALTER TABLE "ProjectTask" ADD COLUMN IF NOT EXISTS "changeRequestId" TEXT;
CREATE INDEX IF NOT EXISTS "ProjectTask_changeRequestId_idx" ON "ProjectTask"("changeRequestId");
ALTER TABLE "ProjectTask" DROP CONSTRAINT IF EXISTS "ProjectTask_changeRequestId_fkey";
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_changeRequestId_fkey"
  FOREIGN KEY ("changeRequestId") REFERENCES "ProjectChangeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
