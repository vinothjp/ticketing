-- Client logs can name the customer product the visit was about.
-- productName is denormalised alongside consultantName so the list needs no join.
ALTER TABLE "ClientLog" ADD COLUMN IF NOT EXISTS "productId" TEXT;
ALTER TABLE "ClientLog" ADD COLUMN IF NOT EXISTS "productName" TEXT;

-- Records which pool this log's draw-down landed in, so an edit/delete reverses
-- exactly what it applied even if the customer later changes contract scope.
ALTER TABLE "ClientLog" ADD COLUMN IF NOT EXISTS "deductedCpId" TEXT;
