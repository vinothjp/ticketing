-- The time zone a tenant's ticket emails print their times in (Organization screen).
-- The server runs on UTC; India (IST) is the default.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "timeZone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';
