-- The Organization screen joins the Option List registry as its own Module.
-- `module` is a label over the registry, deliberately separate from `source`
-- (which table holds the values) — the Organization lists store their values in
-- PicklistOption like the Ticketing ones do, so this adds no third value store.
ALTER TABLE "OptionList" ADD COLUMN IF NOT EXISTS "module" TEXT;

-- The other two Organization settings, chosen from the TIME_FORMAT and CURRENCY
-- option lists. `timeFormat` is live (the ticket screens append it to
-- `dateFormat` for a date-and-time stamp); `currency` is stored config.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "timeFormat" TEXT NOT NULL DEFAULT 'HH:mm';
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'USD';
