-- Purchase order + PO invoice on both coverage scopes.
--
-- A client raises a PO for the support contract, and the invoice for it is
-- scanned in beside the terms. Which pair is in play follows the contract scope,
-- exactly as the terms themselves do: CUSTOMER scope uses the company's own
-- fields (one PO covering everything), PRODUCT scope uses the per-product row's
-- (a different PO and invoice per product).
--
-- `*PoFileUrl` is a served path like the logos ("/uploads/po/<file>");
-- `*PoFileName` keeps the name the admin uploaded, because the stored filename
-- is prefixed and time-stamped and would be unrecognisable in a link.
--
-- Idempotent: safe to re-run.

ALTER TABLE "CustomerCompany"
  ADD COLUMN IF NOT EXISTS "contractPoNumber"   TEXT,
  ADD COLUMN IF NOT EXISTS "contractPoFileUrl"  TEXT,
  ADD COLUMN IF NOT EXISTS "contractPoFileName" TEXT;

ALTER TABLE "CustomerCompanyProduct"
  ADD COLUMN IF NOT EXISTS "poNumber"   TEXT,
  ADD COLUMN IF NOT EXISTS "poFileUrl"  TEXT,
  ADD COLUMN IF NOT EXISTS "poFileName" TEXT;
