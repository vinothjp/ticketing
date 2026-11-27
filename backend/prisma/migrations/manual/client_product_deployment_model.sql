-- How a client runs a product (S/4HANA deployment model): PRIVATE_CLOUD | PUBLIC_CLOUD | ECC | ON_PREMISES.
-- Nullable, no back-fill. Client type gains INTEGRATION and JOB_WORK — a plain String column, no DDL needed.
ALTER TABLE "CustomerCompanyProduct" ADD COLUMN IF NOT EXISTS "deploymentModel" TEXT;
