-- Email Configuration screen: per ticket event, who is notified and how
-- (email and/or bell). Stored config only — nothing sends from it yet.
-- Idempotent: safe to re-run on every container start.
CREATE TABLE IF NOT EXISTS "NotificationRule" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "recipients" TEXT[],
    "email" BOOLEAN NOT NULL DEFAULT true,
    "bell" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "NotificationRule_clientId_idx" ON "NotificationRule"("clientId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NotificationRule_clientId_fkey') THEN
    ALTER TABLE "NotificationRule" ADD CONSTRAINT "NotificationRule_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
