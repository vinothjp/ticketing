-- Migration: project_registers — Risks, Issues, Change Requests, Approvals, MoM, Deadlines, Documents

CREATE TABLE "ProjectRisk" (
    "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "title" TEXT NOT NULL,
    "probability" TEXT NOT NULL DEFAULT 'MEDIUM', "impact" TEXT NOT NULL DEFAULT 'MEDIUM',
    "mitigation" TEXT, "ownerName" TEXT, "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectRisk_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectRisk_projectId_idx" ON "ProjectRisk"("projectId");
ALTER TABLE "ProjectRisk" ADD CONSTRAINT "ProjectRisk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectIssue" (
    "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "title" TEXT NOT NULL, "priority" TEXT,
    "ownerName" TEXT, "targetDate" TIMESTAMP(3), "resolution" TEXT, "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectIssue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectIssue_projectId_idx" ON "ProjectIssue"("projectId");
ALTER TABLE "ProjectIssue" ADD CONSTRAINT "ProjectIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectChangeRequest" (
    "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT, "reason" TEXT,
    "scheduleImpact" TEXT, "budgetImpact" DECIMAL(65,30), "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "requestedBy" TEXT, "decidedAt" TIMESTAMP(3),
    "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectChangeRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectChangeRequest_projectId_idx" ON "ProjectChangeRequest"("projectId");
ALTER TABLE "ProjectChangeRequest" ADD CONSTRAINT "ProjectChangeRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectApproval" (
    "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "gate" TEXT NOT NULL, "approverName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING', "comment" TEXT, "decidedAt" TIMESTAMP(3),
    "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectApproval_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectApproval_projectId_idx" ON "ProjectApproval"("projectId");
ALTER TABLE "ProjectApproval" ADD CONSTRAINT "ProjectApproval_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectMeeting" (
    "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "title" TEXT NOT NULL, "date" TIMESTAMP(3),
    "attendees" TEXT, "notes" TEXT, "actionItems" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectMeeting_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectMeeting_projectId_idx" ON "ProjectMeeting"("projectId");
ALTER TABLE "ProjectMeeting" ADD CONSTRAINT "ProjectMeeting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectDeliveryDeadline" (
    "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "name" TEXT NOT NULL, "deliveryDate" TIMESTAMP(3),
    "notes" TEXT, "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectDeliveryDeadline_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectDeliveryDeadline_projectId_idx" ON "ProjectDeliveryDeadline"("projectId");
ALTER TABLE "ProjectDeliveryDeadline" ADD CONSTRAINT "ProjectDeliveryDeadline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectDocument" (
    "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "docType" TEXT, "name" TEXT NOT NULL, "versionNumber" TEXT,
    "fileName" TEXT, "filePath" TEXT, "mimeType" TEXT, "size" INTEGER, "uploadedBy" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectDocument_projectId_idx" ON "ProjectDocument"("projectId");
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
