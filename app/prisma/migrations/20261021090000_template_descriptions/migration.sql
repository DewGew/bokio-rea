-- Mallbeskrivningar, användningsräknare och kommentar på verifikat
ALTER TABLE "Template" ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN "usageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Verification" ADD COLUMN "comment" TEXT NOT NULL DEFAULT '';

-- Beskrivningar för standardmallarna hos befintliga företag
UPDATE "Template" SET "description" = 'Papper, pennor, pärmar, toner och annat förbrukningsmaterial för kontoret.' WHERE "name" = 'Kontorsmaterial' AND "description" = '';
UPDATE "Template" SET "description" = 'Inventarier med kort livslängd eller lågt värde (under ett halvt prisbasbelopp), t.ex. dator, skärm, mobiltelefon, kontorsstol.' WHERE "name" = 'Förbrukningsinventarier' AND "description" = '';
UPDATE "Template" SET "description" = 'Programvara och prenumerationer från svenska leverantörer. Utländska tjänster bokför du med säljarens land EU eller utanför EU.' WHERE "name" = 'Programvara / prenumeration' AND "description" = '';
UPDATE "Template" SET "description" = 'Internet, bredband, webbhotell, domännamn och servrar.' WHERE "name" = 'Datakommunikation / internet' AND "description" = '';
UPDATE "Template" SET "description" = 'Abonnemang och samtalskostnader för mobiltelefon.' WHERE "name" = 'Mobiltelefon' AND "description" = '';
UPDATE "Template" SET "description" = 'Måltider med kunder och affärskontakter. Momsen på mat är 12 %. Avdragsgill del enligt Skatteverkets regler.' WHERE "name" = 'Representation (avdragsgill)' AND "description" = '';
UPDATE "Template" SET "description" = 'Representation som inte är avdragsgill, t.ex. personalfika utöver enklare förtäring eller gåvor över gränsbeloppet.' WHERE "name" = 'Representation (ej avdragsgill)' AND "description" = '';
UPDATE "Template" SET "description" = 'Tåg-, flyg- och bussbiljetter i Sverige (6 % moms).' WHERE "name" = 'Resa - biljetter' AND "description" = '';
UPDATE "Template" SET "description" = 'Hotell och annan logi i Sverige (12 % moms).' WHERE "name" = 'Hotell' AND "description" = '';
UPDATE "Template" SET "description" = 'Bensin och diesel till företagets fordon.' WHERE "name" = 'Drivmedel' AND "description" = '';
UPDATE "Template" SET "description" = 'Hyra för kontor, lager eller verkstad.' WHERE "name" = 'Lokalhyra' AND "description" = '';
UPDATE "Template" SET "description" = 'Redovisningsbyrå, revisor och bokslutshjälp.' WHERE "name" = 'Redovisningstjänster' AND "description" = '';
UPDATE "Template" SET "description" = 'Annonser, reklam och marknadsföring.' WHERE "name" = 'Annonsering' AND "description" = '';
UPDATE "Template" SET "description" = 'Avgifter till banken. Banktjänster är momsfria.' WHERE "name" = 'Bankavgift' AND "description" = '';
UPDATE "Template" SET "description" = 'Tjänster från länder utanför EU där omvänd skattskyldighet gäller, t.ex. molntjänster från USA. Momsen redovisas i ruta 22, 30 och 48.' WHERE "name" = 'Tjänst från land utanför EU (omvänd moms)' AND "description" = '';
UPDATE "Template" SET "description" = 'Försäljning som betalats direkt med kort, Swish eller kontant (25 % moms).' WHERE "name" = 'Kontantförsäljning 25 %' AND "description" = '';
UPDATE "Template" SET "description" = 'Försäljning av t.ex. livsmedel som betalats direkt (12 % moms).' WHERE "name" = 'Kontantförsäljning 12 %' AND "description" = '';
UPDATE "Template" SET "description" = 'Pengar som ägaren sätter in i företaget som lån.' WHERE "name" = 'Insättning från ägare' AND "description" = '';
