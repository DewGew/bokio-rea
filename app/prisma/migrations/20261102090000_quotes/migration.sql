CREATE TABLE "Quote" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "number" INTEGER,
  "customerId" INTEGER NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "notes" TEXT NOT NULL DEFAULT '',
  "invoiceId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "QuoteLine" (
  "id" SERIAL NOT NULL,
  "quoteId" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'st',
  "unitPrice" INTEGER NOT NULL,
  "vatRate" INTEGER NOT NULL DEFAULT 25,
  "discountBp" INTEGER NOT NULL DEFAULT 0,
  "type" TEXT NOT NULL DEFAULT 'service',
  CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Quote_companyId_number_key" ON "Quote"("companyId", "number");
CREATE UNIQUE INDEX "Quote_invoiceId_key" ON "Quote"("invoiceId");
CREATE INDEX "Quote_companyId_date_idx" ON "Quote"("companyId", "date");
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Company" ADD COLUMN "quoteCounter" INTEGER NOT NULL DEFAULT 0;