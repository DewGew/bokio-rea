/**
 * Skapar ett demokonto med ett fiktivt företag och exempeltransaktioner.
 * Körs bara lokalt (npm run db:seed). Inloggning för demokontot:
 *   e-post:   demo@huvudbok.test
 *   lösenord: demo-huvudbok-2026
 * Kör aldrig mot produktionsdatabasen.
 */
import { PrismaClient } from "@prisma/client";
import { createCompany } from "../src/lib/company-setup";
import { hashPassword } from "../src/lib/password";
import { bookExpense, bookWithTemplate, createVerification, registerInvoicePayment, sendInvoice } from "../src/lib/accounting";

const db = new PrismaClient();
const DEMO_EMAIL = "demo@huvudbok.test";
const DEMO_PASSWORD = "demo-huvudbok-2026";

async function main() {
  if (process.env.VERCEL_ENV === "production") throw new Error("Seed körs inte i produktion.");

  // Ta bort ett tidigare demokonto och dess företag.
  const old = await db.user.findUnique({ where: { email: DEMO_EMAIL }, include: { memberships: true } });
  if (old) {
    await db.company.deleteMany({ where: { id: { in: old.memberships.map((m) => m.companyId) } } });
    await db.user.delete({ where: { id: old.id } });
  }

  const user = await db.user.create({
    data: { email: DEMO_EMAIL, name: "Demo Person", passwordHash: await hashPassword(DEMO_PASSWORD) },
  });
  const company = await db.$transaction((tx) =>
    createCompany(tx, user.id, {
      name: "Demoföretaget AB",
      orgNumber: "556677-8899",
      vatNumber: "SE556677889901",
      address: "Exempelgatan 1",
      postalCode: "111 22",
      city: "Stockholm",
      email: "info@demoforetaget.test",
      bankgiro: "123-4567",
    }),
  );
  const companyId = company.id;

  await db.customer.createMany({
    data: [
      { companyId, name: "Exempelkunden AB", orgNumber: "555555-0002", email: "faktura@exempelkunden.test", address: "Storgatan 5", postalCode: "411 01", city: "Göteborg" },
      { companyId, name: "Testbolaget i Malmö AB", email: "ekonomi@testbolaget.test", address: "Hamngatan 9", postalCode: "211 20", city: "Malmö" },
      { companyId, name: "Anna Andersson", email: "anna@example.com", address: "Byvägen 3", postalCode: "752 30", city: "Uppsala" },
    ],
  });
  await db.article.createMany({
    data: [
      { companyId, name: "Konsulttimme", unit: "tim", price: 95000, vatRate: 25, type: "service" },
      { companyId, name: "Uppstartsavgift", unit: "st", price: 250000, vatRate: 25, type: "service" },
      { companyId, name: "Kurslitteratur", unit: "st", price: 39900, vatRate: 6, type: "goods" },
    ],
  });

  const y = new Date().getUTCFullYear();
  const d = (m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
  const past = (date: Date) => date <= new Date();

  await createVerification(db, companyId, {
    date: d(1, 2),
    description: "Insättning aktiekapital",
    lines: [
      { account: 1930, debit: 2_500_000 },
      { account: 2081, credit: 2_500_000 },
    ],
  });
  const tpl = Object.fromEntries((await db.template.findMany({ where: { companyId } })).map((t) => [t.name, t.id]));
  const purchases: [string, number, number, number, string][] = [
    ["Programvara / prenumeration", 1, 15, 49900, "Projektverktyg, licens"],
    ["Datakommunikation / internet", 2, 3, 21700, "Webbhotell"],
    ["Kontorsmaterial", 2, 20, 34950, "Pärmar och papper"],
    ["Tjänst från land utanför EU (omvänd moms)", 3, 10, 180000, "Molntjänst (USA)"],
    ["Resa - biljetter", 4, 8, 89000, "Tåg Stockholm–Göteborg"],
    ["Representation (avdragsgill)", 5, 14, 112000, "Kundlunch"],
    ["Förbrukningsinventarier", 6, 2, 259000, "Skärm"],
    ["Redovisningstjänster", 7, 1, 312500, "Bokslutshjälp"],
  ];
  for (const [name, m, day, gross, desc] of purchases) {
    if (!past(d(m, day))) continue;
    await bookWithTemplate(companyId, { templateId: tpl[name], date: d(m, day), gross, paymentAccount: 1930, description: desc });
  }

  const customers = await db.customer.findMany({ where: { companyId }, orderBy: { id: "asc" } });
  const invoices: [number, number, number, number, number | null][] = [
    [0, 2, 1, 20, 2],
    [1, 4, 15, 12, 5],
    [0, 6, 1, 30, null],
  ];
  for (const [c, m, day, hours, paidMonth] of invoices) {
    const date = d(m, day);
    if (!past(date)) continue;
    const inv = await db.invoice.create({
      data: {
        companyId,
        customerId: customers[c].id,
        date,
        dueDate: new Date(date.getTime() + 30 * 86400000),
        ourReference: "Demo Person",
        lines: { create: [{ description: "Konsulttimme", quantity: hours, unit: "tim", unitPrice: 95000, vatRate: 25 }] },
      },
    });
    await sendInvoice(companyId, inv.id);
    if (paidMonth) await registerInvoicePayment(companyId, inv.id, d(paidMonth, 28));
  }
  await db.invoice.create({
    data: {
      companyId,
      customerId: customers[2].id,
      date: new Date(new Date().toISOString().slice(0, 10)),
      dueDate: new Date(Date.now() + 30 * 86400000),
      lines: { create: [{ description: "Kurslitteratur", quantity: 2, unitPrice: 39900, vatRate: 6, type: "goods" }] },
    },
  });

  const e1 = await db.expense.create({
    data: { companyId, employee: "Demo Person", date: d(3, 4), description: "Parkering och fika med kund", amount: 18500, vatRate: 25, costAccount: 5800 },
  });
  await bookExpense(companyId, e1.id);
  await db.expense.create({
    data: { companyId, employee: "Demo Person", date: d(5, 20), description: "USB-hubb", amount: 29900, vatRate: 25, costAccount: 5410 },
  });
}

main()
  .then(() => console.log(`Seed klar. Logga in med ${DEMO_EMAIL} (lösenord finns i prisma/seed.ts).`))
  .finally(() => db.$disconnect());
