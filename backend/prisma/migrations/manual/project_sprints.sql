-- Migration: project_sprints (P3 — agile sprints) + project feature toggles
-- NON-DESTRUCTIVE.

-- AlterTable: project feature toggles
ALTER TABLE "Project" ADD COLUMN "features" JSONB NOT NULL DEFAULT '{}';

-- CreateTable: ProjectSprint
CREATE TABLE "ProjectSprint" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',           -- PLANNED | ACTIVE | COMPLETED
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectSprint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectSprint_projectId_idx" ON "ProjectSprint"("projectId");
ALTER TABLE "ProjectSprint" ADD CONSTRAINT "ProjectSprint_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: ProjectTask -> sprint + story points
ALTER TABLE "ProjectTask" ADD COLUMN "sprintId" TEXT;
ALTER TABLE "ProjectTask" ADD COLUMN "storyPoints" INTEGER;
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_sprintId_fkey"
    FOREIGN KEY ("sprintId") REFERENCES "ProjectSprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
