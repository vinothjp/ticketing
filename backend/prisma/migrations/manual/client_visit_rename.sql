-- Client Log -> Client Visit reframe. Every row is a visit now, so the
-- On-site/Remote/Phone split goes away, the Project link goes away, and the
-- status set becomes PLANNED | VISITED | RESCHEDULED.
--
-- The Prisma model was renamed to ClientVisit but keeps @@map("ClientLog"),
-- so the table and column names below are deliberately still the old ones.
-- Idempotent: safe to re-apply to an already-migrated DB.

-- 1. Status remap. COMPLETED was the status that drew down the contract pool;
--    VISITED takes that role, so contractDeducted stays correct as-is and no
--    pool figures need touching. CANCELLED work was never deducted either.
UPDATE "ClientLog" SET "status" = 'VISITED'     WHERE "status" = 'COMPLETED';
UPDATE "ClientLog" SET "status" = 'RESCHEDULED' WHERE "status" = 'CANCELLED';

-- 2. Visit Type is gone — every record is a visit.
ALTER TABLE "ClientLog" DROP COLUMN IF EXISTS "visitType";

-- 3. The Project link is gone; visits attach to a customer/product/ticket only.
ALTER TABLE "ClientLog" DROP COLUMN IF EXISTS "projectId";
