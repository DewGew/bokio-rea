-- Personliga skatteuppgifter för enskilda näringsidkare och handelsbolagsdelägare.
CREATE TABLE "TaxPartner" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "sharePercent" DOUBLE PRECISION NOT NULL DEFAULT 100,
  "birthYear" INTEGER NOT NULL DEFAULT 1980,
  "municipalityTaxRate" DOUBLE PRECISION NOT NULL DEFAULT 32,
  "otherIncome" INTEGER NOT NULL DEFAULT 0,
  "activityType" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxPartner_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaxPartner_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TaxPartner_companyId_idx" ON "TaxPartner"("companyId");
