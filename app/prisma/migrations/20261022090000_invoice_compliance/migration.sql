-- Fakturor enligt svenska krav: säljaruppgifter, momshantering, kreditfakturor, ögonblicksbild och historik.
-- Alla tillägg har standardvärden, så befintliga rader och fakturor påverkas inte.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "fSkatt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "invoiceCounter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lateInterestRate" DOUBLE PRECISION,
ADD COLUMN     "reminderFee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "seat" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "tradeName" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'SE',
ADD COLUMN     "vatNumber" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "creditOfId" INTEGER,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'SEK',
ADD COLUMN     "deliveryDate" TIMESTAMP(3),
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'invoice',
ADD COLUMN     "simplified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "snapshot" JSONB,
ADD COLUMN     "vatNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "vatTreatment" TEXT NOT NULL DEFAULT 'standard';

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "discountBp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "periodStart" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "InvoiceEvent" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "userId" INTEGER,
    "via" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceEvent_invoiceId_idx" ON "InvoiceEvent"("invoiceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_creditOfId_fkey" FOREIGN KEY ("creditOfId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceEvent" ADD CONSTRAINT "InvoiceEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fakturaräknaren börjar på det högsta nummer som redan använts, så att inga nummer återanvänds.
UPDATE "Company" c SET "invoiceCounter" = COALESCE((SELECT MAX(i."number") FROM "Invoice" i WHERE i."companyId" = c."id"), 0);
