-- Client record basics: a named contact person, their phone number, and a logo.
-- The logo is a path under /uploads/logos, same convention as Client.logoUrl.
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "contactPerson" TEXT;
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "contactNumber" TEXT;
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
