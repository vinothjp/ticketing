-- Migration: projects (Project Management)
-- Applied to dev via `prisma db push`; committed for review. NON-DESTRUCTIVE:
-- adds Project + ProjectMember + ProjectTask tables, a per-org project-number
-- sequence, and an optional Ticket->Project link.

-- CreateTable: Project (container for tasks/milestones)
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',              -- OPEN | IN_PROGRESS | ON_HOLD | COMPLETED | CANCELLED
    "priority" TEXT,                                     -- LOW | MEDIUM | HIGH | URGENT
    "managerUserId" TEXT,
    "managerName" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "customerCompanyId" TEXT,
    "createdBy" TEXT,
    "createdByName" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_clientId_projectNumber_key" ON "Project"("clientId", "projectNumber");
CREATE INDEX "Project_clientId_status_idx" ON "Project"("clientId", "status");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_customerCompanyId_fkey"
    FOREIGN KEY ("customerCompanyId") REFERENCES "CustomerCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: ProjectMember (team; mirrors TicketTechnician)
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT,                                         -- MEMBER | MANAGER
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: ProjectTask (task or milestone)
CREATE TABLE "ProjectTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TASK',                 -- TASK | MILESTONE
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeUserId" TEXT,
    "assigneeName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',               -- OPEN | IN_PROGRESS | DONE
    "priority" TEXT,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "plannedEffort" INTEGER,
    "parentTaskId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdByName" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectTask_projectId_status_idx" ON "ProjectTask"("projectId", "status");

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_parentTaskId_fkey"
    FOREIGN KEY ("parentTaskId") REFERENCES "ProjectTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: per-org project-number sequence (PRJ-000001)
ALTER TABLE "Client" ADD COLUMN "projectSequence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: optional Ticket -> Project link
ALTER TABLE "Ticket" ADD COLUMN "projectId" TEXT;
CREATE INDEX "Ticket_clientId_projectId_idx" ON "Ticket"("clientId", "projectId");
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
