-- Migration: project_task_detail (P2 — comments, watchers, dependencies, tags)
-- NON-DESTRUCTIVE: adds tags[] to ProjectTask and three new tables.

-- AlterTable: task tags
ALTER TABLE "ProjectTask" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable: ProjectTaskComment
CREATE TABLE "ProjectTaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorName" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectTaskComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectTaskComment_taskId_createdAt_idx" ON "ProjectTaskComment"("taskId", "createdAt");
ALTER TABLE "ProjectTaskComment" ADD CONSTRAINT "ProjectTaskComment_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: ProjectTaskWatcher
CREATE TABLE "ProjectTaskWatcher" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectTaskWatcher_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectTaskWatcher_taskId_userId_key" ON "ProjectTaskWatcher"("taskId", "userId");
ALTER TABLE "ProjectTaskWatcher" ADD CONSTRAINT "ProjectTaskWatcher_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectTaskWatcher" ADD CONSTRAINT "ProjectTaskWatcher_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: ProjectTaskDependency (successor depends on predecessor)
CREATE TABLE "ProjectTaskDependency" (
    "id" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    CONSTRAINT "ProjectTaskDependency_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectTaskDependency_predecessorId_successorId_key" ON "ProjectTaskDependency"("predecessorId", "successorId");
CREATE INDEX "ProjectTaskDependency_successorId_idx" ON "ProjectTaskDependency"("successorId");
ALTER TABLE "ProjectTaskDependency" ADD CONSTRAINT "ProjectTaskDependency_predecessorId_fkey"
    FOREIGN KEY ("predecessorId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectTaskDependency" ADD CONSTRAINT "ProjectTaskDependency_successorId_fkey"
    FOREIGN KEY ("successorId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
