-- Leverantörsregister och leverantörsfakturor.
CREATE TABLE "Supplier" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "orgNumber" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Supplier_companyId_name_key" ON "Supplier"("companyId", "name");
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SupplierInvoice" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "supplierId" INTEGER NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "amount" INTEGER NOT NULL,
  "vatAmount" INTEGER NOT NULL DEFAULT 0,
  "costAccount" INTEGER NOT NULL DEFAULT 6991,
  "description" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "uploadId" INTEGER,
  "verificationId" INTEGER,
  "paymentVerificationId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupplierInvoice_uploadId_key" ON "SupplierInvoice"("uploadId");
CREATE UNIQUE INDEX "SupplierInvoice_companyId_supplierId_invoiceNumber_key" ON "SupplierInvoice"("companyId", "supplierId", "invoiceNumber");
CREATE INDEX "SupplierInvoice_companyId_status_dueDate_idx" ON "SupplierInvoice"("companyId", "status", "dueDate");
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "Verification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_paymentVerificationId_fkey" FOREIGN KEY ("paymentVerificationId") REFERENCES "Verification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
