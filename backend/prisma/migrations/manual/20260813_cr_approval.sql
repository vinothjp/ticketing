-- Change Request approval by the customer company admin.
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "customerCompanyId" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "approvalStatus"    TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "approvalReason"    TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "decidedById"       TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "decidedAt"         TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "ChangeRequest_customerCompanyId_idx" ON "ChangeRequest" ("customerCompanyId");
