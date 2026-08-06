-- Migration: project_task_lists (Freshservice-style task lists / sections + task keys)
-- NON-DESTRUCTIVE: adds ProjectTaskList, a per-project task-number sequence, and
-- taskListId / taskNumber on ProjectTask.

-- CreateTable: ProjectTaskList (a named section of tasks within a project)
CREATE TABLE "ProjectTaskList" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectTaskList_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectTaskList_projectId_idx" ON "ProjectTaskList"("projectId");
ALTER TABLE "ProjectTaskList" ADD CONSTRAINT "ProjectTaskList_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: per-project task-number sequence (KEY-1, KEY-2, ...)
ALTER TABLE "Project" ADD COLUMN "taskSequence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: ProjectTask -> task list + task number
ALTER TABLE "ProjectTask" ADD COLUMN "taskListId" TEXT;
ALTER TABLE "ProjectTask" ADD COLUMN "taskNumber" INTEGER;
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_taskListId_fkey"
    FOREIGN KEY ("taskListId") REFERENCES "ProjectTaskList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
