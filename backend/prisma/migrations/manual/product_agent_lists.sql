-- Generic products (description + per-product tracks) and module consultant
-- lists (multiple agents per module/track, one flagged primary) replacing the
-- old fixed primary/secondary rank slots.

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "tracks" TEXT[] NOT NULL DEFAULT ARRAY['TECHNICAL','FUNCTIONAL'];

ALTER TABLE "ModuleConsultant"
  ADD COLUMN IF NOT EXISTS "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Carry the old rank into the new list shape: primary → isPrimary, ordered first.
UPDATE "ModuleConsultant"
  SET "isPrimary" = ("rank" = 'PRIMARY'),
      "sortOrder" = CASE WHEN "rank" = 'PRIMARY' THEN 0 ELSE 1 END
  WHERE "rank" IS NOT NULL;

-- Swap the uniqueness: an agent appears once per module+track (list), no rank.
ALTER TABLE "ModuleConsultant" DROP CONSTRAINT IF EXISTS "ModuleConsultant_moduleId_track_rank_key";
ALTER TABLE "ModuleConsultant" DROP COLUMN IF EXISTS "rank";

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ModuleConsultant_moduleId_track_userId_key'
  ) THEN
    ALTER TABLE "ModuleConsultant"
      ADD CONSTRAINT "ModuleConsultant_moduleId_track_userId_key" UNIQUE ("moduleId", "track", "userId");
  END IF;
END $$;
