-- Migration: project_wbs — reshape PM to the Excel model
-- Renames task lists → milestones, turns ProjectTask into a WBS node, and moves
-- task status to the 4-state Kanban set. Data-preserving (dev applied via db push).

-- Project header/overview fields
ALTER TABLE "Project" ADD COLUMN "projectCode" TEXT;
ALTER TABLE "Project" ADD COLUMN "projectSponsor" TEXT;
ALTER TABLE "Project" ADD COLUMN "department" TEXT;
ALTER TABLE "Project" ADD COLUMN "budget" DECIMAL(65,30);
ALTER TABLE "Project" ADD COLUMN "currency" TEXT;
ALTER TABLE "Project" ADD COLUMN "projectType" TEXT;
ALTER TABLE "Project" ADD COLUMN "goLiveDate" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "objective" TEXT;
ALTER TABLE "Project" ADD COLUMN "scope" TEXT;
ALTER TABLE "Project" ADD COLUMN "outOfScope" TEXT;
ALTER TABLE "Project" ADD COLUMN "successCriteria" TEXT;

-- Task list → milestone (rename keeps the FK; add stage-gate fields)
ALTER TABLE "ProjectTaskList" RENAME TO "ProjectMilestone";
ALTER TABLE "ProjectMilestone" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "ProjectMilestone" ADD COLUMN "targetDate" TIMESTAMP(3);

-- Task grouping column rename
ALTER TABLE "ProjectTask" RENAME COLUMN "taskListId" TO "milestoneId";

-- WBS columns on ProjectTask
ALTER TABLE "ProjectTask" ADD COLUMN "wbsType" TEXT NOT NULL DEFAULT 'TASK';   -- PHASE|TASK|SUBTASK|ACTIVITY|CHECKLIST|MILESTONE
ALTER TABLE "ProjectTask" ADD COLUMN "wbsCode" TEXT;
ALTER TABLE "ProjectTask" ADD COLUMN "durationDays" INTEGER;
ALTER TABLE "ProjectTask" ADD COLUMN "completionPct" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProjectTask" ADD COLUMN "actualStart" TIMESTAMP(3);
ALTER TABLE "ProjectTask" ADD COLUMN "actualFinish" TIMESTAMP(3);
ALTER TABLE "ProjectTask" ADD COLUMN "estimatedHours" INTEGER;
ALTER TABLE "ProjectTask" ADD COLUMN "actualHours" INTEGER;
ALTER TABLE "ProjectTask" ADD COLUMN "critical" BOOLEAN NOT NULL DEFAULT false;

-- Status backfill: OPEN→TODO, DONE→COMPLETED (IN_PROGRESS unchanged)
UPDATE "ProjectTask" SET "status" = 'TODO' WHERE "status" = 'OPEN';
UPDATE "ProjectTask" SET "status" = 'COMPLETED' WHERE "status" = 'DONE';
UPDATE "ProjectTask" SET "completionPct" = 100 WHERE "status" = 'COMPLETED';
ALTER TABLE "ProjectTask" ALTER COLUMN "status" SET DEFAULT 'TODO';
