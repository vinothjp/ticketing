-- Migration: template_designer
-- Generated with `prisma migrate diff` (read-only) against the dev schema.
--
-- DESTRUCTIVE: drops the RequestType table and several Ticket columns
-- (root-cause block + customerConfirmation), whose data moves into the new
-- Template/TemplateField custom-field model and Ticket.customFields JSONB.
-- Only run against a database with no data you need to keep.
--
-- To apply in a dev environment, prefer the Prisma workflow instead of running
-- this by hand:
--   npm run prisma:migrate    # prisma migrate dev  (creates history + applies)
--   npm run prisma:seed       # loads the common templates
-- This file is committed only so reviewers can see the exact DB delta.

-- DropForeignKey
ALTER TABLE "RequestType" DROP CONSTRAINT "RequestType_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Template" DROP CONSTRAINT "Template_requestTypeId_fkey";

-- DropForeignKey
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_requestTypeId_fkey";

-- DropIndex
DROP INDEX "Template_requestTypeId_key";

-- AlterTable
ALTER TABLE "Template" DROP COLUMN "requestTypeId",
ADD COLUMN     "category" TEXT,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "defaultPriority" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "icon" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TemplateField" ADD COLUMN     "dataType" TEXT,
ADD COLUMN     "group" TEXT,
ADD COLUMN     "isCustom" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "label" TEXT,
ADD COLUMN     "options" JSONB,
ADD COLUMN     "placeholder" TEXT;

-- AlterTable
ALTER TABLE "Ticket" DROP COLUMN "correctionAction",
DROP COLUMN "customerConfirmation",
DROP COLUMN "lessonsLearned",
DROP COLUMN "preventionAction",
DROP COLUMN "requestTypeId",
DROP COLUMN "rootCauseCategory",
DROP COLUMN "rootCauseDescription",
ADD COLUMN     "customFields" JSONB NOT NULL DEFAULT '{}';

-- DropTable
DROP TABLE "RequestType";

-- CreateIndex
CREATE UNIQUE INDEX "Template_clientId_name_key" ON "Template"("clientId", "name");

-- CreateIndex
CREATE INDEX "Ticket_customFields_idx" ON "Ticket" USING GIN ("customFields" jsonb_ops);

