-- A customer's request to reopen a resolved/closed ticket, approved by the
-- client product's project manager (or a tenant Admin). Idempotent.
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "reopenRequestStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "reopenRequestReason" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "reopenRequestedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "reopenRequestedById" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "reopenApproverUserId" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "reopenDecidedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "reopenDecidedById" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "reopenDecisionNote" TEXT;
