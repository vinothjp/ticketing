-- Projects are no longer deleted; they are deactivated instead (idempotent).
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
