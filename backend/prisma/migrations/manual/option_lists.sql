-- Unified Option List registry: one row per dropdown list, whatever module it
-- drives. Values keep living in "PicklistOption" / "ChangeRequestOption" — this
-- table only records the list itself, so no data moves and no consumer changes.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "OptionList" (
  "id"            TEXT PRIMARY KEY,
  "clientId"      TEXT NOT NULL,
  "code"          TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "description"   TEXT,
  "source"        TEXT NOT NULL DEFAULT 'PICKLIST',
  "listKey"       TEXT NOT NULL,
  "parentListKey" TEXT,
  "allowCustom"   BOOLEAN NOT NULL DEFAULT false,
  "isSystem"      BOOLEAN NOT NULL DEFAULT false,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"     TEXT,
  "updatedBy"     TEXT
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OptionList_clientId_fkey'
  ) THEN
    ALTER TABLE "OptionList"
      ADD CONSTRAINT "OptionList_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "OptionList_clientId_code_key"
  ON "OptionList" ("clientId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "OptionList_clientId_source_listKey_key"
  ON "OptionList" ("clientId", "source", "listKey");
