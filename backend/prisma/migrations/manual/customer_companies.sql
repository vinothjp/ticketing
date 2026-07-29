-- Migration: customer_companies
-- Additive change for Phase 7 (external customer companies). Applied to the dev
-- database via `prisma db push`; this file is committed so reviewers can see the
-- exact DB delta. NON-DESTRUCTIVE: only adds a new table, two nullable columns,
-- and indexes/foreign keys. No existing data is dropped or modified.

-- CreateTable
CREATE TABLE "CustomerCompany" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "contactEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "maxContacts" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    CONSTRAINT "CustomerCompany_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCompany_clientId_name_key" ON "CustomerCompany"("clientId", "name");

-- AlterTable: link contact users to their company (null for internal staff/agents)
ALTER TABLE "User" ADD COLUMN "customerCompanyId" TEXT;

-- AlterTable: tag tickets with the raising customer company
ALTER TABLE "Ticket" ADD COLUMN "customerCompanyId" TEXT;

-- CreateIndex
CREATE INDEX "Ticket_clientId_customerCompanyId_idx" ON "Ticket"("clientId", "customerCompanyId");

-- AddForeignKey
ALTER TABLE "CustomerCompany" ADD CONSTRAINT "CustomerCompany_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_customerCompanyId_fkey"
    FOREIGN KEY ("customerCompanyId") REFERENCES "CustomerCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_customerCompanyId_fkey"
    FOREIGN KEY ("customerCompanyId") REFERENCES "CustomerCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
