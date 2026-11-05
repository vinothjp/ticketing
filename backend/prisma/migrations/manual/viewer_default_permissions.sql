-- Correct the legacy blanket "Viewer" permissions.
--
-- prisma/seed.ts gave Viewer view-only on every form, which leaves an internal
-- agent — the role that actually holds tickets — unable to create or update
-- one, while still able to read Roles and Settings. Bring those rows in line
-- with DEFAULT_ROLE_PERMISSIONS (backend/src/permissions/default-permissions.ts).
--
-- Idempotent, and deliberately narrow: it only rewrites a row that is still in
-- the untouched seed shape (view-only, every other flag false). A tenant admin
-- who has since ticked anything on the Roles screen keeps their edit. Re-running
-- after it has applied reports UPDATE 0.

-- Tickets: an agent works them.
UPDATE "FormPermission" p
   SET "canCreate" = true, "canUpdate" = true, "canExport" = true, "updatedAt" = now()
  FROM "Role" r, "AppForm" f
 WHERE p."roleId" = r.id AND p."formId" = f.id
   AND r.name = 'Viewer' AND f.name = 'Tickets'
   AND p."canView" AND NOT p."canCreate" AND NOT p."canUpdate"
   AND NOT p."canDelete" AND NOT p."canExport" AND NOT p."canImport";

-- Reports: readable and exportable.
UPDATE "FormPermission" p
   SET "canExport" = true, "updatedAt" = now()
  FROM "Role" r, "AppForm" f
 WHERE p."roleId" = r.id AND p."formId" = f.id
   AND r.name = 'Viewer' AND f.name = 'Reports'
   AND p."canView" AND NOT p."canCreate" AND NOT p."canUpdate"
   AND NOT p."canDelete" AND NOT p."canExport" AND NOT p."canImport";

-- Roles, Settings, Invoices: not an agent's business.
UPDATE "FormPermission" p
   SET "canView" = false, "updatedAt" = now()
  FROM "Role" r, "AppForm" f
 WHERE p."roleId" = r.id AND p."formId" = f.id
   AND r.name = 'Viewer' AND f.name IN ('Roles', 'Settings', 'Invoices')
   AND p."canView" AND NOT p."canCreate" AND NOT p."canUpdate"
   AND NOT p."canDelete" AND NOT p."canExport" AND NOT p."canImport";
