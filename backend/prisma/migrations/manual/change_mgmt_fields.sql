-- Change Management rework: new General-section fields, stage pipeline, CAB approval,
-- and dependent-picklist support on the CR option store. Idempotent / additive.

-- 1. Dependent-picklist parent on the option store (subcategory -> category).
ALTER TABLE "ChangeRequestOption" ADD COLUMN IF NOT EXISTS "parentValue" TEXT;

-- 2. New columns on ChangeRequest.
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "changeType"        TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "changeGroup"       TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "changeOwner"       TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "subCategory"       TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "impact"            TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "servicesAffected"  TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "comments"          TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "stage"             TEXT NOT NULL DEFAULT 'Submission';
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "changeCoordinator" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "implementor"       TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "lineManager"       TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "reviewer"          TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "changeApprover"    TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "cabApprovalStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "cabReason"         TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "cabDecidedById"    TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "cabDecidedAt"      TIMESTAMP(3);

-- 3. Seed the new Change-Management option lists for every EXISTING tenant that
--    already has CR options (ensureDefaults only fires for brand-new tenants).
--    Non-destructive: existing values are left in place; only missing rows added.
--    ON CONFLICT (clientId, listKey, value) DO NOTHING keeps it idempotent.
INSERT INTO "ChangeRequestOption" ("id", "clientId", "listKey", "value", "label", "parentValue", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), c."id", v."listKey", v."value", v."value", v."parentValue", v."sortOrder", true, now(), now()
FROM "Client" c
CROSS JOIN (
  VALUES
    ('change_type',  'Emergency',                     NULL::text, 0),
    ('change_type',  'Major',                         NULL,       1),
    ('change_type',  'Minor',                         NULL,       2),
    ('change_type',  'Standard',                      NULL,       3),
    ('change_group', 'Infrastructure',                NULL,       0),
    ('change_group', 'Software',                      NULL,       1),
    ('impact',       'Affects Business',              NULL,       0),
    ('impact',       'Affects Department',            NULL,       1),
    ('impact',       'Affects Group',                 NULL,       2),
    ('impact',       'Affects User',                  NULL,       3),
    ('impact',       'No Impact',                     NULL,       4),
    ('risk',         'Low',                           NULL,       0),
    ('risk',         'Medium',                        NULL,       1),
    ('risk',         'High',                          NULL,       2),
    ('subcategory',  'SAP',                           'Application', 0),
    ('subcategory',  'B1',                            'Application', 1),
    ('priority',     'Urgent',                        NULL,       3),
    ('category',     'Application',                   NULL,       0),
    ('category',     'Email',                         NULL,       1),
    ('category',     'Downtime',                      NULL,       2),
    ('category',     'Network',                       NULL,       3),
    ('category',     'OS',                            NULL,       4),
    ('status',       'Requested',                     NULL,       0),
    ('status',       'Accepted',                      NULL,       1),
    ('status',       'Rejected',                      NULL,       2),
    ('status',       'Request for additional info',   NULL,       3),
    ('status',       'Submitted for Authorisation',   NULL,       4)
) AS v("listKey", "value", "parentValue", "sortOrder")
WHERE EXISTS (SELECT 1 FROM "ChangeRequestOption" o WHERE o."clientId" = c."id")
ON CONFLICT ("clientId", "listKey", "value") DO NOTHING;
