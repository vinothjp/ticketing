-- Migration: change_request — standalone Change Request (CR) module
-- (applied automatically by `prisma db push` on backend start; kept here for parity/audit)

-- Per-client CR number sequence (powers CR-000001).
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "crSequence" INTEGER NOT NULL DEFAULT 0;

-- Self-contained option store for the CR module's dropdowns.
CREATE TABLE IF NOT EXISTS "ChangeRequestOption" (
  "id"        TEXT NOT NULL,
  "clientId"  TEXT NOT NULL,
  "listKey"   TEXT NOT NULL,
  "value"     TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  CONSTRAINT "ChangeRequestOption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ChangeRequestOption_clientId_listKey_value_key"
  ON "ChangeRequestOption"("clientId", "listKey", "value");
CREATE INDEX IF NOT EXISTS "ChangeRequestOption_clientId_listKey_idx"
  ON "ChangeRequestOption"("clientId", "listKey");
ALTER TABLE "ChangeRequestOption" DROP CONSTRAINT IF EXISTS "ChangeRequestOption_clientId_fkey";
ALTER TABLE "ChangeRequestOption" ADD CONSTRAINT "ChangeRequestOption_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Change Request record.
CREATE TABLE IF NOT EXISTS "ChangeRequest" (
  "id"                   TEXT NOT NULL,
  "clientId"             TEXT NOT NULL,
  "crNumber"             TEXT NOT NULL,
  "customer"             TEXT,
  "projectName"          TEXT,
  "moduleName"           TEXT,
  "crType"               TEXT,
  "priority"             TEXT,
  "crCategory"           TEXT,
  "status"               TEXT NOT NULL DEFAULT 'New',
  "requestedBy"          TEXT,
  "businessOwner"        TEXT,
  "functionalConsultant" TEXT,
  "technicalConsultant"  TEXT,
  "projectManager"       TEXT,
  "title"                TEXT NOT NULL,
  "description"          TEXT,
  "featureName"          TEXT,
  "crDate"               TIMESTAMP(3),
  "crStartDate"          TIMESTAMP(3),
  "crEndDate"            TIMESTAMP(3),
  "targetReleaseDate"    TIMESTAMP(3),
  "expectedGoLiveDate"   TIMESTAMP(3),
  "createdBy"            TEXT,
  "createdByName"        TEXT,
  "updatedBy"            TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ChangeRequest_clientId_crNumber_key"
  ON "ChangeRequest"("clientId", "crNumber");
CREATE INDEX IF NOT EXISTS "ChangeRequest_clientId_status_idx"
  ON "ChangeRequest"("clientId", "status");
ALTER TABLE "ChangeRequest" DROP CONSTRAINT IF EXISTS "ChangeRequest_clientId_fkey";
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 2: Business Requirement section.
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "requirementDetails" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "objective" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "reasonForCr" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "benefitToCustomer" TEXT;

-- Phase 3: Blue Print section.
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "blueprintName" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "blueprintVersionNumber" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "blueprintPreparedBy" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "blueprintReviewedBy" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "blueprintApprovedBy" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "blueprintApprovalDate" TIMESTAMP(3);
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "blueprintRemarks" TEXT;

-- Phase 3: Change Request attachments (blueprint / supportive / uat slots).
CREATE TABLE IF NOT EXISTS "ChangeRequestAttachment" (
  "id"              TEXT NOT NULL,
  "changeRequestId" TEXT NOT NULL,
  "entityType"      TEXT NOT NULL,
  "title"           TEXT,
  "fileName"        TEXT,
  "filePath"        TEXT,
  "mimeType"        TEXT,
  "size"            INTEGER,
  "url"             TEXT,
  "uploadedBy"      TEXT,
  "uploadedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChangeRequestAttachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ChangeRequestAttachment_changeRequestId_entityType_idx"
  ON "ChangeRequestAttachment"("changeRequestId", "entityType");
ALTER TABLE "ChangeRequestAttachment" DROP CONSTRAINT IF EXISTS "ChangeRequestAttachment_changeRequestId_fkey";
ALTER TABLE "ChangeRequestAttachment" ADD CONSTRAINT "ChangeRequestAttachment_changeRequestId_fkey"
  FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 5: Impact Analysis section.
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "affectedModule" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "affectedTables" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "impactReports" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "impactInterfaces" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "impactForms" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "impactWorkflow" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "masterData" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "authorizations" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "performance" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "risk" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "estimatedHours" DECIMAL(65,30);
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "complexity" TEXT;

-- Phase 6: Development Details section.
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "developer" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "developmentStatus" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "developmentStartDate" TIMESTAMP(3);
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "completionDate" TIMESTAMP(3);
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "transportNumber" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "gitRepository" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "buildNumber" TEXT;

-- Phase 7: Testing section.
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "testCase" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "testingPerson" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "testingStatus" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "uatPerformedBy" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "defectCount" INTEGER;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "retest" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "testApproval" TEXT;

-- Phase 8: Deployment section.
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "deploymentPlan" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "goLiveChecklist" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "rollbackPlan" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "transportList" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "deploymentDate" TIMESTAMP(3);
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "supportWindow" TEXT;
