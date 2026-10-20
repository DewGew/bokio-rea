import type { Prisma } from "@prisma/client";
import { BAS_ACCOUNTS } from "./bas";

export const DEFAULT_TEMPLATES: {
  name: string;
  category: string;
  costAccount: number;
  vatRate: number;
  direction?: string;
  vatAccount?: number;
  keywords: string;
}[] = [
  { name: "Kontorsmaterial", category: "Inköp", costAccount: 6110, vatRate: 25, keywords: "papper penna kontor" },
  { name: "Förbrukningsinventarier", category: "Inköp", costAccount: 5410, vatRate: 25, keywords: "mus tangentbord skärm" },
  { name: "Programvara / prenumeration", category: "Inköp", costAccount: 5420, vatRate: 25, keywords: "licens saas abonnemang" },
  { name: "Datakommunikation / internet", category: "Inköp", costAccount: 6230, vatRate: 25, keywords: "bredband internet webbhotell domän" },
  { name: "Mobiltelefon", category: "Inköp", costAccount: 6212, vatRate: 25, keywords: "telefon mobil" },
  { name: "Representation (avdragsgill)", category: "Inköp", costAccount: 6071, vatRate: 12, keywords: "lunch middag kund" },
  { name: "Representation (ej avdragsgill)", category: "Inköp", costAccount: 6072, vatRate: 0, keywords: "fika personal" },
  { name: "Resa - biljetter", category: "Resor", costAccount: 5810, vatRate: 6, keywords: "tåg flyg buss sj" },
  { name: "Hotell", category: "Resor", costAccount: 5831, vatRate: 12, keywords: "hotell logi" },
  { name: "Drivmedel", category: "Resor", costAccount: 5611, vatRate: 25, keywords: "bensin diesel tank" },
  { name: "Lokalhyra", category: "Lokal", costAccount: 5010, vatRate: 25, keywords: "hyra kontor" },
  { name: "Redovisningstjänster", category: "Tjänster", costAccount: 6530, vatRate: 25, keywords: "redovisning bokföring revisor" },
  { name: "Annonsering", category: "Tjänster", costAccount: 5910, vatRate: 25, keywords: "annons reklam marknadsföring" },
  { name: "Bankavgift", category: "Bank", costAccount: 6570, vatRate: 0, keywords: "bank avgift" },
  { name: "Tjänst från land utanför EU (omvänd moms)", category: "Utland", costAccount: 4531, vatRate: 25, direction: "reverse", keywords: "google aws openai utland" },
  { name: "Kontantförsäljning 25 %", category: "Försäljning", costAccount: 3001, vatRate: 25, direction: "sale", vatAccount: 2611, keywords: "försäljning kassa swish" },
  { name: "Kontantförsäljning 12 %", category: "Försäljning", costAccount: 3002, vatRate: 12, direction: "sale", vatAccount: 2621, keywords: "livsmedel" },
  { name: "Insättning från ägare", category: "Ägare", costAccount: 2893, vatRate: 0, direction: "sale", keywords: "insättning lån ägare" },
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
};

/** Skapar ett företag med BAS-kontoplan och standardmallar, och gör användaren till ägare. */
export async function createCompany(tx: Prisma.TransactionClient, userId: number, input: CompanyInput) {
  const company = await tx.company.create({
    data: { ...input, memberships: { create: { userId, role: "owner" } } },
  });
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
