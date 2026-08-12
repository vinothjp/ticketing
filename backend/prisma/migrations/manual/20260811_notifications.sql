-- In-app notifications (bell feed).
CREATE TABLE IF NOT EXISTS "Notification" (
  id         TEXT PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "userId"   TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  "ticketId" TEXT,
  read       BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "Notification_userId_read_idx" ON "Notification" ("userId", read);
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification" ("userId", "createdAt");
