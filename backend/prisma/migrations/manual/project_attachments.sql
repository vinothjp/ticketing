-- Generic project attachments (file upload OR pasted link) for any sub-entity
-- (invoice / document / risk / issue / …), scoped by entityType + entityId.
CREATE TABLE IF NOT EXISTS "ProjectAttachment" (
  "id"         TEXT NOT NULL,
  "projectId"  TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId"   TEXT NOT NULL,
  "fileName"   TEXT,
  "filePath"   TEXT,
  "mimeType"   TEXT,
  "size"       INTEGER,
  "url"        TEXT,
  "uploadedBy" TEXT,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProjectAttachment_projectId_entityType_entityId_idx"
  ON "ProjectAttachment" ("projectId", "entityType", "entityId");

ALTER TABLE "ProjectAttachment"
  ADD CONSTRAINT "ProjectAttachment_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
