-- Integration and Job Work were withdrawn as client types (client request).
-- Both behaved exactly like Implementation (services only), so any client
-- stored with one is relabelled Implementation — nothing else about it changes.
-- Idempotent: a re-run finds nothing left to update.
UPDATE "CustomerCompany" SET "clientType" = 'IMPLEMENTATION'
WHERE "clientType" IN ('INTEGRATION', 'JOB_WORK');
