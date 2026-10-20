-- Inställningar för bokföring och moms
ALTER TABLE "Company" ADD COLUMN     "accountingMethod" TEXT NOT NULL DEFAULT 'invoice',
ADD COLUMN     "companyType" TEXT NOT NULL DEFAULT 'ab',
ADD COLUMN     "euTrade" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fiscalStartMonth" INTEGER NOT NULL DEFAULT 1;

-- Räkenskapsår
CREATE TABLE "FiscalYear" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FiscalYear_companyId_start_key" ON "FiscalYear"("companyId", "start");
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Befintliga företag får kalenderår som räkenskapsår: ett år för varje år från det första
-- verifikatet (eller i år) till och med det senaste (eller i år), utan luckor.
INSERT INTO "FiscalYear" ("companyId", "start", "end")
SELECT c."id", make_timestamp(y, 1, 1, 0, 0, 0), make_timestamp(y, 12, 31, 0, 0, 0)
FROM "Company" c
CROSS JOIN LATERAL (
  SELECT LEAST(COALESCE(MIN(v."year"), EXTRACT(YEAR FROM now())::int), EXTRACT(YEAR FROM now())::int) AS lo,
         GREATEST(COALESCE(MAX(v."year"), EXTRACT(YEAR FROM now())::int), EXTRACT(YEAR FROM now())::int) AS hi
  FROM "Verification" v WHERE v."companyId" = c."id"
) r
CROSS JOIN LATERAL generate_series(r.lo, r.hi) AS y;

-- Koppla befintliga verifikat till sitt räkenskapsår (numreringen behålls).
ALTER TABLE "Verification" ADD COLUMN "fiscalYearId" INTEGER;
UPDATE "Verification" v SET "fiscalYearId" = f."id"
FROM "FiscalYear" f
WHERE f."companyId" = v."companyId" AND f."start" = make_timestamp(v."year", 1, 1, 0, 0, 0);
ALTER TABLE "Verification" ALTER COLUMN "fiscalYearId" SET NOT NULL;

DROP INDEX "Verification_companyId_series_year_number_key";
ALTER TABLE "Verification" DROP COLUMN "year";
CREATE UNIQUE INDEX "Verification_companyId_series_fiscalYearId_number_key" ON "Verification"("companyId", "series", "fiscalYearId", "number");
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
