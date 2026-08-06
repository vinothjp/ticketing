-- Migration: project_cleanup — remove redundant Members/Deadlines/Approvals;
-- fold stage-gate sign-off into Milestones.

-- Milestone approval fields (from the former Approvals register)
ALTER TABLE "ProjectMilestone" ADD COLUMN "approverName" TEXT;
ALTER TABLE "ProjectMilestone" ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "ProjectMilestone" ADD COLUMN "decidedAt" TIMESTAMP(3);

-- Drop redundant tables (duplicates of Resources / Milestones)
DROP TABLE IF EXISTS "ProjectMember";
DROP TABLE IF EXISTS "ProjectApproval";
DROP TABLE IF EXISTS "ProjectDeliveryDeadline";
