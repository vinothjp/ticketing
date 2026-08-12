-- Project templates: reusable WBS blueprints applied on project creation.
CREATE TABLE IF NOT EXISTS "ProjectTemplate" (
  id          TEXT PRIMARY KEY,
  "clientId"  TEXT NOT NULL REFERENCES "Client"(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  category    TEXT,
  icon        TEXT,
  color       TEXT,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  blueprint   JSONB NOT NULL DEFAULT '{"milestones":[]}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "createdBy" TEXT,
  "updatedBy" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectTemplate_clientId_name_key"
  ON "ProjectTemplate" ("clientId", name);
