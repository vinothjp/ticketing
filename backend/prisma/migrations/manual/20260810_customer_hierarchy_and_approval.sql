-- Phase 1: customer-company hierarchy + ticket creation-approval gate.
-- Idempotent (safe to re-run). Applies to the running dev DB; schema.prisma
-- + `prisma db push` reconcile the same DDL on backend restart.

-- 1) Ticket approval-gate columns ------------------------------------------
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "approvalStatus"  TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "approvedById"    TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "approvedAt"      TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "rejectedById"    TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "rejectedAt"      TIMESTAMP(3);

-- 2) CustomerAdmin role, one per tenant (Client) ---------------------------
INSERT INTO "Role" (id, name, description, "clientId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'CustomerAdmin', 'Customer company administrator', c.id, now(), now()
FROM "Client" c
ON CONFLICT ("clientId", name) DO NOTHING;

-- 3) 'Rejected' ticket status option, one per tenant -----------------------
INSERT INTO "PicklistOption" (id, "clientId", "listKey", value, label, "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), c.id, 'ticketStatus', 'Rejected', 'Rejected', 100, true, now(), now()
FROM "Client" c
ON CONFLICT ("clientId", "listKey", value) DO NOTHING;

-- 4) Promote demo customer admins (keep their Customer role for Phase-1
--    safety — StaffGuard still blocks them until Phase 2 recognises the new role)
INSERT INTO "UserRole" (id, "userId", "roleId", "createdAt")
SELECT gen_random_uuid(), u.id, r.id, now()
FROM "User" u
JOIN "Role" r ON r.name = 'CustomerAdmin' AND r."clientId" = u."clientId"
WHERE u.username IN ('globex_amy', 'initech_ivan')
ON CONFLICT ("userId", "roleId") DO NOTHING;

-- 5) Add an Initech employee (Globex already has globex_bob as an employee).
--    Reuses ivan's password hash (Admin@123) and Initech's company id.
INSERT INTO "User" (id, username, email, "passwordHash", "isActive", "clientId", "customerCompanyId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'initech_emp', 'emp@initech.example', u."passwordHash", true, u."clientId", u."customerCompanyId", now(), now()
FROM "User" u WHERE u.username = 'initech_ivan'
ON CONFLICT (email) DO NOTHING;

INSERT INTO "UserRole" (id, "userId", "roleId", "createdAt")
SELECT gen_random_uuid(), nu.id, r.id, now()
FROM "User" nu
JOIN "Role" r ON r.name = 'Customer' AND r."clientId" = nu."clientId"
WHERE nu.username = 'initech_emp'
ON CONFLICT ("userId", "roleId") DO NOTHING;
