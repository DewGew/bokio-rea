import type { Prisma } from "@prisma/client";
import { BAS_ACCOUNTS } from "./bas";
import { createFirstFiscalYear } from "./fiscal";

export const DEFAULT_TEMPLATES: {
  name: string;
  category: string;
  costAccount: number;
  vatRate: number;
  direction?: string;
  vatAccount?: number;
  keywords: string;
  description?: string;
}[] = [
  { name: "Kontorsmaterial", category: "Inköp", costAccount: 6110, vatRate: 25, keywords: "papper penna kontor", description: "Papper, pennor, pärmar, toner och annat förbrukningsmaterial för kontoret." },
  { name: "Förbrukningsinventarier", category: "Inköp", costAccount: 5410, vatRate: 25, keywords: "mus tangentbord skärm", description: "Inventarier med kort livslängd eller lågt värde (under ett halvt prisbasbelopp), t.ex. dator, skärm, mobiltelefon, kontorsstol." },
  { name: "Programvara / prenumeration", category: "Inköp", costAccount: 5420, vatRate: 25, keywords: "licens saas abonnemang", description: "Programvara och prenumerationer från svenska leverantörer. Utländska tjänster bokför du med säljarens land EU eller utanför EU." },
  { name: "Datakommunikation / internet", category: "Inköp", costAccount: 6230, vatRate: 25, keywords: "bredband internet webbhotell domän", description: "Internet, bredband, webbhotell, domännamn och servrar." },
  { name: "Mobiltelefon", category: "Inköp", costAccount: 6212, vatRate: 25, keywords: "telefon mobil", description: "Abonnemang och samtalskostnader för mobiltelefon." },
  { name: "Representation (avdragsgill)", category: "Inköp", costAccount: 6071, vatRate: 12, keywords: "lunch middag kund", description: "Måltider med kunder och affärskontakter. Momsen på mat är 12 %. Avdragsgill del enligt Skatteverkets regler." },
  { name: "Representation (ej avdragsgill)", category: "Inköp", costAccount: 6072, vatRate: 0, keywords: "fika personal", description: "Representation som inte är avdragsgill, t.ex. personalfika utöver enklare förtäring eller gåvor över gränsbeloppet." },
  { name: "Resa - biljetter", category: "Resor", costAccount: 5810, vatRate: 6, keywords: "tåg flyg buss sj", description: "Tåg-, flyg- och bussbiljetter i Sverige (6 % moms)." },
  { name: "Hotell", category: "Resor", costAccount: 5831, vatRate: 12, keywords: "hotell logi", description: "Hotell och annan logi i Sverige (12 % moms)." },
  { name: "Drivmedel", category: "Resor", costAccount: 5611, vatRate: 25, keywords: "bensin diesel tank", description: "Bensin och diesel till företagets fordon." },
  { name: "Lokalhyra", category: "Lokal", costAccount: 5010, vatRate: 25, keywords: "hyra kontor", description: "Hyra för kontor, lager eller verkstad." },
  { name: "Redovisningstjänster", category: "Tjänster", costAccount: 6530, vatRate: 25, keywords: "redovisning bokföring revisor", description: "Redovisningsbyrå, revisor och bokslutshjälp." },
  { name: "Annonsering", category: "Tjänster", costAccount: 5910, vatRate: 25, keywords: "annons reklam marknadsföring", description: "Annonser, reklam och marknadsföring." },
  { name: "Bankavgift", category: "Bank", costAccount: 6570, vatRate: 0, keywords: "bank avgift", description: "Avgifter till banken. Banktjänster är momsfria." },
  { name: "Tjänst från land utanför EU (omvänd moms)", category: "Utland", costAccount: 4531, vatRate: 25, direction: "reverse", keywords: "google aws openai utland", description: "Tjänster från länder utanför EU där omvänd skattskyldighet gäller, t.ex. molntjänster från USA. Momsen redovisas i ruta 22, 30 och 48." },
  { name: "IT-tjänster", category: "Tjänster", costAccount: 6540, vatRate: 25, keywords: "konsult it support webbutveckling utvecklare", description: "IT-konsulter, support, webbutveckling och andra IT-tjänster från svenska leverantörer." },
  { name: "Porto och frakt", category: "Inköp", costAccount: 6250, vatRate: 25, keywords: "porto frimärke postnord frakt dhl bring", description: "Porto, frimärken och fraktkostnader." },
  { name: "Företagsförsäkring", category: "Tjänster", costAccount: 6310, vatRate: 0, keywords: "försäkring", description: "Företagsförsäkringar. Försäkringar är momsfria." },
  { name: "Taxi", category: "Resor", costAccount: 5800, vatRate: 6, keywords: "taxi uber bolt", description: "Taxiresor i tjänsten (6 % moms)." },
  { name: "Parkering", category: "Resor", costAccount: 5800, vatRate: 25, keywords: "parkering easypark parkster", description: "Parkeringsavgifter i tjänsten (25 % moms)." },
  { name: "Facklitteratur och tidningar", category: "Inköp", costAccount: 6970, vatRate: 6, keywords: "bok böcker tidning tidskrift", description: "Facklitteratur, tidningar och tidskrifter (6 % moms)." },
  { name: "Inköp av varor", category: "Inköp", costAccount: 4010, vatRate: 25, keywords: "varor varuinköp grossist lager material", description: "Varor som köps in för att säljas vidare eller ingå i det du säljer." },
  { name: "Städning", category: "Lokal", costAccount: 5060, vatRate: 25, keywords: "städ städning rengöring", description: "Städning av lokaler och kontor." },
  { name: "Förbrukningsmaterial", category: "Inköp", costAccount: 5460, vatRate: 25, keywords: "förbrukningsmaterial material verktyg", description: "Material som förbrukas i verksamheten, t.ex. rengöringsmedel och mindre verktyg." },
  { name: "Dator eller inventarie (tillgång)", category: "Inköp", costAccount: 1250, vatRate: 25, keywords: "dator inventarie tillgång avskrivning", description: "Datorer och inventarier värda mer än ett halvt prisbasbelopp och med livslängd över tre år. Bokförs som tillgång och skrivs av." },
  { name: "Kontantförsäljning 25 %", category: "Försäljning", costAccount: 3001, vatRate: 25, direction: "sale", vatAccount: 2611, keywords: "försäljning kassa swish", description: "Försäljning som betalats direkt med kort, Swish eller kontant (25 % moms)." },
  { name: "Kontantförsäljning 12 %", category: "Försäljning", costAccount: 3002, vatRate: 12, direction: "sale", vatAccount: 2621, keywords: "livsmedel", description: "Försäljning av t.ex. livsmedel som betalats direkt (12 % moms)." },
  { name: "Insättning från ägare", category: "Ägare", costAccount: 2893, vatRate: 0, direction: "sale", keywords: "insättning lån ägare", description: "Pengar som ägaren sätter in i företaget som lån." },
];

export type CompanyInput = {
  name: string;
  orgNumber: string;
  vatNumber?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  email?: string;
  bankgiro?: string;
  companyType?: string;
  vatPeriod?: string;
  fiscalStartMonth?: number;
};

export const COMPANY_TYPES = { ab: "Aktiebolag", ef: "Enskild firma", hb: "Handelsbolag / kommanditbolag", ek: "Ekonomisk förening" } as const;
export const isCompanyType = (s: string): s is keyof typeof COMPANY_TYPES => Object.hasOwn(COMPANY_TYPES, s);
export const isVatPeriod = (s: string) => ["month", "quarter", "year", "none"].includes(s);

/** Skapar ett företag med BAS-kontoplan och standardmallar, och gör användaren till ägare. */
export async function createCompany(tx: Prisma.TransactionClient, userId: number, input: CompanyInput) {
  // Enskild firma har alltid kalenderår som räkenskapsår.
  const fiscalStartMonth = input.companyType === "ef" ? 1 : (input.fiscalStartMonth ?? 1);
  const company = await tx.company.create({
    // Alla nya företag börjar som Gratis. Pro sätts av en administratör.
    data: { ...input, plan: "free", fiscalStartMonth, memberships: { create: { userId, role: "owner" } } },
  });
  await createFirstFiscalYear(tx, company.id, fiscalStartMonth);
  await tx.account.createMany({
    data: BAS_ACCOUNTS.map(([number, name, vatCode]) => ({ companyId: company.id, number, name, vatCode: vatCode ?? "" })),
  });
  await tx.template.createMany({
    data: DEFAULT_TEMPLATES.map((t) => ({ direction: "purchase", vatAccount: null, ...t, companyId: company.id })),
  });
  return company;
}

/** Validerar ett svenskt organisations- eller personnummer (Luhn). */
export function validOrgNumber(s: string) {
  const digits = s.replace(/\D/g, "");
  const ten = digits.length === 12 ? digits.slice(2) : digits;
  if (ten.length !== 10) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let n = Number(ten[i]) * (i % 2 === 0 ? 2 : 1);
    if (n > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
}
