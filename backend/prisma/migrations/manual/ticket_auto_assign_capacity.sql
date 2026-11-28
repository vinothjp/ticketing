-- Ticket auto-assignment capacity + default issue type (Organization screen),
-- and the Products screen's stored "Assign consultants" mode.
-- Idempotent: runs on every container start.

ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "ticketMaxOpenPerAgent" INTEGER DEFAULT 10;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "defaultIssueType" TEXT NOT NULL DEFAULT 'TECHNICAL';

-- The mode used to be guessed from whether the product has modules. Seeded only
-- when the column is added, so an admin's later choice is never re-derived.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Product' AND column_name = 'consultantMode'
  ) THEN
    ALTER TABLE "Product" ADD COLUMN "consultantMode" TEXT NOT NULL DEFAULT 'PRODUCT';
    UPDATE "Product" p SET "consultantMode" = 'MODULES'
    WHERE EXISTS (SELECT 1 FROM "ProductModule" m WHERE m."productId" = p.id);
  END IF;
END $$;

-- Only the current mode's consultants may exist (client request): clear the
-- left-overs of the other mode — on the Products screen and on every client's
-- product page. The app keeps it that way, so a re-run deletes nothing.
DELETE FROM "ProductConsultant" pc USING "Product" p
WHERE pc."productId" = p.id AND p."consultantMode" = 'MODULES';

DELETE FROM "ModuleConsultant" mc USING "ProductModule" m, "Product" p
WHERE mc."moduleId" = m.id AND m."productId" = p.id AND p."consultantMode" = 'PRODUCT';

DELETE FROM "CustomerConsultant" cc USING "Product" p
WHERE cc."productId" = p.id AND p."consultantMode" = 'MODULES' AND cc."moduleId" IS NULL;

DELETE FROM "CustomerConsultant" cc USING "Product" p
WHERE cc."productId" = p.id AND p."consultantMode" = 'PRODUCT' AND cc."moduleId" IS NOT NULL;
