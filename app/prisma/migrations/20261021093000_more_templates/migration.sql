-- Fler standardmallar för befintliga företag
INSERT INTO "Template" ("companyId","name","category","costAccount","vatRate","direction","keywords","description")
SELECT c."id", 'IT-tjänster', 'Tjänster', 6540, 25, 'purchase', 'konsult it support webbutveckling utvecklare', 'IT-konsulter, support, webbutveckling och andra IT-tjänster från svenska leverantörer.' FROM "Company" c
WHERE EXISTS (SELECT 1 FROM "Account" a WHERE a."companyId" = c."id" AND a."number" = 6540)
  AND NOT EXISTS (SELECT 1 FROM "Template" t WHERE t."companyId" = c."id" AND t."name" = 'IT-tjänster');
INSERT INTO "Template" ("companyId","name","category","costAccount","vatRate","direction","keywords","description")
SELECT c."id", 'Porto och frakt', 'Inköp', 6250, 25, 'purchase', 'porto frimärke postnord frakt dhl bring', 'Porto, frimärken och fraktkostnader.' FROM "Company" c
WHERE EXISTS (SELECT 1 FROM "Account" a WHERE a."companyId" = c."id" AND a."number" = 6250)
  AND NOT EXISTS (SELECT 1 FROM "Template" t WHERE t."companyId" = c."id" AND t."name" = 'Porto och frakt');
INSERT INTO "Template" ("companyId","name","category","costAccount","vatRate","direction","keywords","description")
SELECT c."id", 'Företagsförsäkring', 'Tjänster', 6310, 0, 'purchase', 'försäkring', 'Företagsförsäkringar. Försäkringar är momsfria.' FROM "Company" c
WHERE EXISTS (SELECT 1 FROM "Account" a WHERE a."companyId" = c."id" AND a."number" = 6310)
  AND NOT EXISTS (SELECT 1 FROM "Template" t WHERE t."companyId" = c."id" AND t."name" = 'Företagsförsäkring');
INSERT INTO "Template" ("companyId","name","category","costAccount","vatRate","direction","keywords","description")
SELECT c."id", 'Taxi', 'Resor', 5800, 6, 'purchase', 'taxi uber bolt', 'Taxiresor i tjänsten (6 % moms).' FROM "Company" c
WHERE EXISTS (SELECT 1 FROM "Account" a WHERE a."companyId" = c."id" AND a."number" = 5800)
  AND NOT EXISTS (SELECT 1 FROM "Template" t WHERE t."companyId" = c."id" AND t."name" = 'Taxi');
INSERT INTO "Template" ("companyId","name","category","costAccount","vatRate","direction","keywords","description")
SELECT c."id", 'Parkering', 'Resor', 5800, 25, 'purchase', 'parkering easypark parkster', 'Parkeringsavgifter i tjänsten (25 % moms).' FROM "Company" c
WHERE EXISTS (SELECT 1 FROM "Account" a WHERE a."companyId" = c."id" AND a."number" = 5800)
  AND NOT EXISTS (SELECT 1 FROM "Template" t WHERE t."companyId" = c."id" AND t."name" = 'Parkering');
INSERT INTO "Template" ("companyId","name","category","costAccount","vatRate","direction","keywords","description")
SELECT c."id", 'Facklitteratur och tidningar', 'Inköp', 6970, 6, 'purchase', 'bok böcker tidning tidskrift', 'Facklitteratur, tidningar och tidskrifter (6 % moms).' FROM "Company" c
WHERE EXISTS (SELECT 1 FROM "Account" a WHERE a."companyId" = c."id" AND a."number" = 6970)
  AND NOT EXISTS (SELECT 1 FROM "Template" t WHERE t."companyId" = c."id" AND t."name" = 'Facklitteratur och tidningar');
INSERT INTO "Template" ("companyId","name","category","costAccount","vatRate","direction","keywords","description")
SELECT c."id", 'Inköp av varor', 'Inköp', 4010, 25, 'purchase', 'varor varuinköp grossist lager material', 'Varor som köps in för att säljas vidare eller ingå i det du säljer.' FROM "Company" c
WHERE EXISTS (SELECT 1 FROM "Account" a WHERE a."companyId" = c."id" AND a."number" = 4010)
  AND NOT EXISTS (SELECT 1 FROM "Template" t WHERE t."companyId" = c."id" AND t."name" = 'Inköp av varor');
INSERT INTO "Template" ("companyId","name","category","costAccount","vatRate","direction","keywords","description")
SELECT c."id", 'Städning', 'Lokal', 5060, 25, 'purchase', 'städ städning rengöring', 'Städning av lokaler och kontor.' FROM "Company" c
WHERE EXISTS (SELECT 1 FROM "Account" a WHERE a."companyId" = c."id" AND a."number" = 5060)
  AND NOT EXISTS (SELECT 1 FROM "Template" t WHERE t."companyId" = c."id" AND t."name" = 'Städning');
INSERT INTO "Template" ("companyId","name","category","costAccount","vatRate","direction","keywords","description")
SELECT c."id", 'Förbrukningsmaterial', 'Inköp', 5460, 25, 'purchase', 'förbrukningsmaterial material verktyg', 'Material som förbrukas i verksamheten, t.ex. rengöringsmedel och mindre verktyg.' FROM "Company" c
WHERE EXISTS (SELECT 1 FROM "Account" a WHERE a."companyId" = c."id" AND a."number" = 5460)
  AND NOT EXISTS (SELECT 1 FROM "Template" t WHERE t."companyId" = c."id" AND t."name" = 'Förbrukningsmaterial');
INSERT INTO "Template" ("companyId","name","category","costAccount","vatRate","direction","keywords","description")
SELECT c."id", 'Dator eller inventarie (tillgång)', 'Inköp', 1250, 25, 'purchase', 'dator inventarie tillgång avskrivning', 'Datorer och inventarier värda mer än ett halvt prisbasbelopp och med livslängd över tre år. Bokförs som tillgång och skrivs av.' FROM "Company" c
WHERE EXISTS (SELECT 1 FROM "Account" a WHERE a."companyId" = c."id" AND a."number" = 1250)
  AND NOT EXISTS (SELECT 1 FROM "Template" t WHERE t."companyId" = c."id" AND t."name" = 'Dator eller inventarie (tillgång)');
