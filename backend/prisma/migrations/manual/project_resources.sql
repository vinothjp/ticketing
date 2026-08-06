-- Migration: project_resources — Resource Cost catalog, Resources Plan, Timesheets

-- Tenant cost catalog
CREATE TABLE "ResourceCategory" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hourlyCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "billingRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "dailyHours" INTEGER NOT NULL DEFAULT 8,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResourceCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResourceCategory_clientId_name_key" ON "ResourceCategory"("clientId", "name");
ALTER TABLE "ResourceCategory" ADD CONSTRAINT "ResourceCategory_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Resources plan
CREATE TABLE "ProjectResource" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "consultantName" TEXT,
    "categoryId" TEXT,
    "role" TEXT,
    "allocationPct" INTEGER NOT NULL DEFAULT 100,
    "dailyHours" INTEGER NOT NULL DEFAULT 8,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectResource_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectResource_projectId_idx" ON "ProjectResource"("projectId");
ALTER TABLE "ProjectResource" ADD CONSTRAINT "ProjectResource_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectResource" ADD CONSTRAINT "ProjectResource_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectResource" ADD CONSTRAINT "ProjectResource_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "ResourceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Timesheets
CREATE TABLE "ProjectTimesheet" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "consultantName" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "taskId" TEXT,
    "activity" TEXT,
    "hours" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "workPerformed" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectTimesheet_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectTimesheet_projectId_date_idx" ON "ProjectTimesheet"("projectId", "date");
ALTER TABLE "ProjectTimesheet" ADD CONSTRAINT "ProjectTimesheet_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectTimesheet" ADD CONSTRAINT "ProjectTimesheet_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
