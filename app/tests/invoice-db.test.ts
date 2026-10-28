// Integrationstester mot databasen: nummerserie vid samtidig utfärdning, ögonblicksbild, kreditfaktura, historik och
// att ett företag inte kan nå ett annat företags fakturor. Körs med `npm test` (kräver DATABASE_URL, t.ex. Docker lokalt).
// Testerna skapar egna, fiktiva företag och tar bort dem efteråt.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { createCompany } from "../src/lib/company-setup";
import { AccountingError, creditInvoice, registerInvoicePayment, sendInvoice } from "../src/lib/accounting";
import { buildInvoiceDoc, invoiceDoc } from "../src/lib/invoice-doc";
import { invoiceTotals } from "../src/lib/invoice-rules";

let available = true;
let userId = 0;
let A = 0;
let B = 0;
let customerA = 0;
let customerB = 0;
const stamp = Date.now();

before(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    available = false;
    return;
  }
  const user = await db.user.create({ data: { email: `faktura-test-${stamp}@huvudbok.test`, name: "Fakturatest", passwordHash: "x" } });
  userId = user.id;
  const make = (name: string) =>
    db.$transaction((tx) =>
      createCompany(tx, user.id, { name, orgNumber: "556677-8899", vatNumber: "SE556677889901", address: "Testgatan 1", postalCode: "111 22", city: "Stockholm", email: "test@huvudbok.test" }),
    );
  A = (await make(`Testbolag A ${stamp} AB`)).id;
  B = (await make(`Testbolag B ${stamp} AB`)).id;
  await db.company.updateMany({ where: { id: { in: [A, B] } }, data: { seat: "Stockholm", bankgiro: "123-4567", fSkatt: true } });
  customerA = (await db.customer.create({ data: { companyId: A, name: "Kund A AB", address: "Kundvägen 1", postalCode: "222 33", city: "Lund" } })).id;
  customerB = (await db.customer.create({ data: { companyId: B, name: "Kund B AB", address: "Kundvägen 2", postalCode: "222 33", city: "Lund" } })).id;
});

after(async () => {
  if (!available) return;
  await db.company.deleteMany({ where: { id: { in: [A, B] } } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

const draft = (companyId: number, customerId: number, lines = [{ description: "Konsulttimme", quantity: 2, unitPrice: 95000, vatRate: 25 }]) =>
  db.invoice.create({
    data: { companyId, customerId, date: new Date("2026-10-22T00:00:00Z"), dueDate: new Date("2026-11-21T00:00:00Z"), lines: { create: lines } },
  });

test("samtidig utfärdning ger unika nummer i obruten serie", async (t) => {
  if (!available) return t.skip("ingen databas");
  const drafts = await Promise.all(Array.from({ length: 10 }, () => draft(A, customerA)));
  const issued = await Promise.all(drafts.map((d) => sendInvoice(A, d.id)));
  const numbers = issued.map((i) => i.number!).sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 10 }, (_, i) => numbers[0] + i));
  assert.equal(new Set(numbers).size, 10);
});

test("utfärdad faktura behåller företags- och kunduppgifterna från utfärdandet", async (t) => {
  if (!available) return t.skip("ingen databas");
  const d = await draft(A, customerA);
  await sendInvoice(A, d.id, { userId });
  await db.company.update({ where: { id: A }, data: { address: "Ny adress 99", bankgiro: "999-9999" } });
  await db.customer.update({ where: { id: customerA }, data: { address: "Flyttat 5" } });
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: d.id }, include: { customer: true, lines: true } });
  const company = await db.company.findUniqueOrThrow({ where: { id: A } });
  const doc = invoiceDoc(inv, company);
  assert.equal(doc.seller.address, "Testgatan 1");
  assert.equal(doc.payment.bankgiro, "123-4567");
  assert.equal(doc.buyer.address, "Kundvägen 1");
  assert.ok(inv.issuedAt);
  // Ett utkast visar däremot aktuella uppgifter.
  const fresh = buildInvoiceDoc({ ...inv, snapshot: null }, company);
  assert.equal(fresh.seller.address, "Ny adress 99");
  await db.company.update({ where: { id: A }, data: { address: "Testgatan 1", bankgiro: "123-4567" } });
  await db.customer.update({ where: { id: customerA }, data: { address: "Kundvägen 1" } });
});

test("kreditfaktura: eget nummer, hänvisning, negativa belopp och omvänd bokföring", async (t) => {
  if (!available) return t.skip("ingen databas");
  const d = await draft(A, customerA, [
    { description: "Tjänst", quantity: 3, unitPrice: 33333, vatRate: 25 },
    { description: "Bok", quantity: 1, unitPrice: 29900, vatRate: 6 },
  ]);
  const original = await sendInvoice(A, d.id, { userId });
  const credit = await creditInvoice(A, d.id, { userId });
  assert.equal(credit.kind, "credit");
  assert.equal(credit.creditOfId, d.id);
  assert.equal(credit.number, original.number! + 1);
  const [o, c] = await Promise.all([
    db.invoice.findUniqueOrThrow({ where: { id: d.id }, include: { lines: true, verification: { include: { lines: true } }, events: true } }),
    db.invoice.findUniqueOrThrow({ where: { id: credit.id }, include: { lines: true, verification: { include: { lines: true } } } }),
  ]);
  assert.equal(o.status, "credited");
  assert.equal(invoiceTotals(c.lines).total, -invoiceTotals(o.lines).total);
  // Kreditfakturans verifikat tar ut originalets: summan per konto blir noll.
  const sum = new Map<number, number>();
  for (const l of [...o.verification!.lines, ...c.verification!.lines]) sum.set(l.accountNumber, (sum.get(l.accountNumber) ?? 0) + l.debit - l.credit);
  assert.ok([...sum.values()].every((v) => v === 0));
  assert.deepEqual(o.events.map((e) => e.type), ["issued", "credited"]);
  // Originalets innehåll är oförändrat.
  assert.equal(o.number, original.number);
  await assert.rejects(creditInvoice(A, d.id), AccountingError, "en faktura kan bara krediteras en gång");
  await assert.rejects(registerInvoicePayment(A, credit.id, new Date()), AccountingError, "en kreditfaktura ska inte betalas");
});

test("validering stoppar utfärdande när lagstadgade uppgifter saknas", async (t) => {
  if (!available) return t.skip("ingen databas");
  await db.company.update({ where: { id: B }, data: { seat: "" } });
  const d = await draft(B, customerB);
  await assert.rejects(sendInvoice(B, d.id), /säte/);
  const still = await db.invoice.findUniqueOrThrow({ where: { id: d.id } });
  assert.equal(still.status, "draft");
  assert.equal(still.number, null);
  await db.company.update({ where: { id: B }, data: { seat: "Stockholm" } });
});

test("ett företag kan inte utfärda, kreditera, betala eller läsa ett annat företags fakturor", async (t) => {
  if (!available) return t.skip("ingen databas");
  const d = await draft(A, customerA);
  await assert.rejects(sendInvoice(B, d.id), /finns inte/);
  await sendInvoice(A, d.id);
  await assert.rejects(creditInvoice(B, d.id), /finns inte/);
  await assert.rejects(registerInvoicePayment(B, d.id, new Date()), /finns inte/);
  // Samma fråga som PDF-routen gör: fakturan söks alltid inom det inloggade företaget.
  assert.equal(await db.invoice.findFirst({ where: { id: d.id, companyId: B } }), null);
  // Företag B:s nummerserie påverkas inte av företag A.
  const b = await draft(B, customerB);
  const issuedB = await sendInvoice(B, b.id);
  // En ny serie börjar på 10 (fakturanummer ska ha minst två siffror).
  assert.equal(issuedB.number, 10);
});
