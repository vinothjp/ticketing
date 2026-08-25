-- Notification.link: the in-app route the bell should open.
-- Client-visit notifications point at a screen that is not a ticket, so the
-- bell can no longer navigate on ticketId alone.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "link" TEXT;
