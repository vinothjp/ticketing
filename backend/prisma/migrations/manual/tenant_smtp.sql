-- Migration: tenant_smtp
-- Per-organization SMTP config. Applied to dev via `prisma db push --accept-data-loss`
-- (only the single global row exists, so the unique add is safe). Committed for review.
-- NON-DESTRUCTIVE: adds a nullable column, a unique index, and a foreign key.

-- AlterTable: link an SmtpConfig row to a tenant (null = the platform-global config)
ALTER TABLE "SmtpConfig" ADD COLUMN "clientId" TEXT;

-- CreateIndex (Postgres allows multiple NULLs, so the global row coexists)
CREATE UNIQUE INDEX "SmtpConfig_clientId_key" ON "SmtpConfig"("clientId");

-- AddForeignKey
ALTER TABLE "SmtpConfig" ADD CONSTRAINT "SmtpConfig_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Note: SmtpConfig.id default also changes from 'global' to uuid() (Prisma-level);
-- the existing global row keeps id = 'global' with clientId = NULL.
