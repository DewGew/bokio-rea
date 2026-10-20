-- Bokslut: koppla bokslutsverifikat till räkenskapsåret
ALTER TABLE "FiscalYear" ADD COLUMN "closingVerificationIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- Nya konton som bokslutet använder läggs till hos befintliga företag
INSERT INTO "Account" ("companyId", "number", "name", "vatCode", "active")
SELECT c."id", a.number, a.name, '', true
FROM "Company" c
CROSS JOIN (VALUES (2019, 'Årets resultat (enskild firma/handelsbolag)'), (2512, 'Beräknad inkomstskatt')) AS a(number, name)
ON CONFLICT ("companyId", "number") DO NOTHING;
