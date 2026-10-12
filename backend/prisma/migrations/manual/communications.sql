-- Communication emails & monthly newsletter (backend/src/communications/).
-- An Admin writes a communication and sends it now or schedules it; every
-- active staff member gets an in-app notification and their own email.
-- CommunicationRecipient is the per-person delivery log.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "Communication" (
  "id"             TEXT PRIMARY KEY,
  "clientId"       TEXT NOT NULL REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind"           TEXT NOT NULL DEFAULT 'ANNOUNCEMENT',
  "subject"        TEXT NOT NULL,
  "body"           TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'DRAFT',
  "scheduledAt"    TIMESTAMP(3),
  "sentAt"         TIMESTAMP(3),
  "recipientCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount"    INTEGER NOT NULL DEFAULT 0,
  "createdBy"      TEXT,
  "createdByName"  TEXT,
  "updatedBy"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "Communication_clientId_status_idx" ON "Communication"("clientId", "status");
CREATE INDEX IF NOT EXISTS "Communication_status_scheduledAt_idx" ON "Communication"("status", "scheduledAt");

CREATE TABLE IF NOT EXISTS "CommunicationRecipient" (
  "id"              TEXT PRIMARY KEY,
  "communicationId" TEXT NOT NULL REFERENCES "Communication"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId"          TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "email"           TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "error"           TEXT,
  "sentAt"          TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "CommunicationRecipient_communicationId_userId_key" ON "CommunicationRecipient"("communicationId", "userId");
CREATE INDEX IF NOT EXISTS "CommunicationRecipient_communicationId_status_idx" ON "CommunicationRecipient"("communicationId", "status");

-- Gallery albums attached to a communication (announce an album; the newsletter's
-- albums section). Added after the table first shipped, hence the separate step.
ALTER TABLE "Communication" ADD COLUMN IF NOT EXISTS "albumIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
