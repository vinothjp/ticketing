-- One account manager per client, one product manager per product of a client.
-- Both are internal staff users; deleting a user is refused while they hold
-- either (users/user-links.ts), and the FK nulls it out as a backstop.
ALTER TABLE "CustomerCompany" ADD COLUMN IF NOT EXISTS "accountManagerId" TEXT;
ALTER TABLE "CustomerCompanyProduct" ADD COLUMN IF NOT EXISTS "productManagerId" TEXT;

ALTER TABLE "CustomerCompany" DROP CONSTRAINT IF EXISTS "CustomerCompany_accountManagerId_fkey";
ALTER TABLE "CustomerCompany" ADD CONSTRAINT "CustomerCompany_accountManagerId_fkey"
  FOREIGN KEY ("accountManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerCompanyProduct" DROP CONSTRAINT IF EXISTS "CustomerCompanyProduct_productManagerId_fkey";
ALTER TABLE "CustomerCompanyProduct" ADD CONSTRAINT "CustomerCompanyProduct_productManagerId_fkey"
  FOREIGN KEY ("productManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
