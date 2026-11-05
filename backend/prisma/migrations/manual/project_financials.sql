-- Migration: project_financials — Expenses + Invoices

CREATE TABLE "ProjectExpense" (
    "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "category" TEXT NOT NULL, "description" TEXT,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0, "date" TIMESTAMP(3),
    "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectExpense_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectExpense_projectId_idx" ON "ProjectExpense"("projectId");
ALTER TABLE "ProjectExpense" ADD CONSTRAINT "ProjectExpense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectInvoice" (
    "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "invoiceNumber" TEXT NOT NULL, "invoiceDate" TIMESTAMP(3),
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0, "amountPaid" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "type" TEXT, "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectInvoice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectInvoice_projectId_idx" ON "ProjectInvoice"("projectId");
ALTER TABLE "ProjectInvoice" ADD CONSTRAINT "ProjectInvoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
