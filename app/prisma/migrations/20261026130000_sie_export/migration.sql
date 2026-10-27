-- CreateTable
CREATE TABLE "SieExport" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "fiscalYearId" INTEGER NOT NULL,
    "exportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SieExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SieExport_companyId_fiscalYearId_key" ON "SieExport"("companyId", "fiscalYearId");

-- AddForeignKey
ALTER TABLE "SieExport" ADD CONSTRAINT "SieExport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SieExport" ADD CONSTRAINT "SieExport_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
