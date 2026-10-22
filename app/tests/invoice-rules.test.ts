// Fakturaregler: belopp, moms, momshantering, validering och Swish-QR. Körs med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  invoiceTotals,
  lineNet,
  salesAccount,
  swishPayload,
  suggestedVatNote,
  validateInvoice,
  validOrgNumber,
  validSwedishVatNumber,
  validVatNumberFormat,
  isOrganisationNumber,
  blocking,
  type ValidationInput,
} from "../src/lib/invoice-rules";

const line = (unitPrice: number, vatRate: number, quantity = 1, extra: Record<string, unknown> = {}) => ({ description: "Rad", quantity, unitPrice, vatRate, ...extra });

// Fiktivt men formellt giltigt säljarföretag (kontrollsiffran stämmer).
const seller: ValidationInput["seller"] = {
  name: "Testbolaget AB",
  orgNumber: "556677-8899",
  vatNumber: "SE556677889901",
  address: "Gatan 1",
  postalCode: "111 22",
  city: "Stockholm",
  companyType: "ab",
  seat: "Stockholm",
  vatRegistered: true,
  bankgiro: "123-4567",
  plusgiro: "",
  iban: "",
  swishNumber: "",
};
const buyer = { name: "Kund AB", orgNumber: "", vatNumber: "", address: "Vägen 2", postalCode: "222 33", city: "Lund", country: "SE" };
const base = (patch: Partial<ValidationInput> = {}, inv: Partial<ValidationInput["invoice"]> = {}): ValidationInput => ({
  seller,
  buyer,
  invoice: { date: "2026-10-22", dueDate: "2026-11-21", deliveryDate: null, vatTreatment: "standard", vatNote: "", simplified: false, ...inv },
  lines: [line(100000, 25)],
  ...patch,
});
const errors = (i: ValidationInput) => blocking(validateInvoice(i)).map((e) => e.field);

test("moms 25, 12, 6 och 0 % och flera satser på samma faktura", () => {
  const t = invoiceTotals([line(100000, 25), line(100000, 12), line(100000, 6), line(100000, 0)]);
  assert.equal(t.net, 400000);
  assert.deepEqual([...t.byRate.entries()].map(([r, v]) => [r, v.vat]), [
    [25, 25000],
    [12, 12000],
    [6, 6000],
    [0, 0],
  ]);
  assert.equal(t.total, 443000);
});

test("momsen räknas per momssats och avrundas till hela ören", () => {
  // 3 × 33,33 kr = 99,99 kr; 25 % = 24,9975 kr → 25,00 kr
  const t = invoiceTotals([line(3333, 25, 3)]);
  assert.equal(t.net, 9999);
  assert.equal(t.vat, 2500);
  assert.equal(t.total, 12499);
});

test("rabatt per rad och summa före rabatt", () => {
  const l = line(100000, 25, 2, { discountBp: 1250 }); // 2 × 1 000 kr, 12,5 % rabatt
  assert.equal(lineNet(l), 175000);
  const t = invoiceTotals([l]);
  assert.equal(t.discount, 25000);
  assert.equal(t.vat, 43750);
  assert.equal(t.total, 218750);
});

test("kreditfaktura är exakt originalet med omvänt tecken (symmetrisk avrundning)", () => {
  const original = [line(1250, 25, 1), line(4999, 12, 3, { discountBp: 333 })];
  const credit = original.map((l) => ({ ...l, quantity: -l.quantity }));
  const a = invoiceTotals(original);
  const b = invoiceTotals(credit);
  assert.equal(b.net, -a.net);
  assert.equal(b.vat, -a.vat);
  assert.equal(b.total, -a.total);
});

test("intäktskonton per momshantering", () => {
  assert.equal(salesAccount("standard", { vatRate: 25 }), 3001);
  assert.equal(salesAccount("standard", { vatRate: 12 }), 3002);
  assert.equal(salesAccount("standard", { vatRate: 6 }), 3003);
  assert.equal(salesAccount("standard", { vatRate: 0 }), 3004);
  assert.equal(salesAccount("eu", { vatRate: 0, type: "goods" }), 3108);
  assert.equal(salesAccount("eu", { vatRate: 0, type: "service" }), 3308);
  assert.equal(salesAccount("export", { vatRate: 0, type: "goods" }), 3105);
  assert.equal(salesAccount("reverse_domestic", { vatRate: 0 }), 3231);
});

test("identitetsnummer: kontrollsiffra, organisationsnummer och momsnummer", () => {
  assert.ok(validOrgNumber("556677-8899"));
  assert.ok(!validOrgNumber("556677-8898"));
  assert.ok(validOrgNumber("19811218-9876"));
  assert.ok(isOrganisationNumber("556677-8899"));
  assert.ok(!isOrganisationNumber("811218-9876")); // personnummer
  assert.ok(validSwedishVatNumber("SE556677889901"));
  assert.ok(!validSwedishVatNumber("SE556677889902"));
  assert.ok(validVatNumberFormat("DE123456789"));
  assert.ok(!validVatNumberFormat("XX123"));
});

test("en korrekt faktura har inga fel", () => {
  assert.deepEqual(errors(base()), []);
});

test("aktiebolag måste ange styrelsens säte", () => {
  assert.ok(errors(base({ seller: { ...seller, seat: "" } })).includes("seller.seat"));
  assert.ok(!errors(base({ seller: { ...seller, seat: "", companyType: "ef", orgNumber: "811218-9876", vatNumber: "SE811218987601" } })).includes("seller.seat"));
});

test("momsregistreringsnumret ska stämma med organisationsnumret", () => {
  assert.ok(errors(base({ seller: { ...seller, vatNumber: "SE556074308901" } })).includes("seller.vatNumber"));
});

test("betalningsuppgifter krävs på fakturor men inte på kreditfakturor", () => {
  const noPay = { ...seller, bankgiro: "" };
  assert.ok(errors(base({ seller: noPay })).includes("seller.payment"));
  assert.ok(!errors(base({ seller: noPay, kind: "credit", lines: [line(100000, 25, -1)] })).includes("seller.payment"));
});

test("momsundantag och 0 % kräver en hänvisning (fakturatext)", () => {
  assert.ok(errors(base({ lines: [line(100000, 0)] })).includes("vatNote"));
  assert.deepEqual(errors(base({ lines: [line(100000, 0)] }, { vatNote: "Undantagen från skatteplikt enligt 10 kap. mervärdesskattelagen." })), []);
  const exempt = base({ lines: [line(100000, 25)] }, { vatTreatment: "exempt", vatNote: "Undantag" });
  assert.ok(errors(exempt).includes("vat"), "momsfri försäljning får inte ha moms på raderna");
});

test("EU-försäljning kräver köparens momsnummer, annat land och fakturatext", () => {
  const eu = base({ lines: [line(100000, 0, 1, { type: "service" })] }, { vatTreatment: "eu", vatNote: "" });
  const e = errors(eu);
  assert.ok(e.includes("customer.vatNumber"));
  assert.ok(e.includes("customer.country"));
  assert.ok(e.includes("vatNote"));
  const ok = base({ buyer: { ...buyer, country: "DE", vatNumber: "DE123456789" }, lines: [line(100000, 0, 1, { type: "service" })] }, { vatTreatment: "eu", vatNote: suggestedVatNote("eu", [{ type: "service" }]) });
  assert.deepEqual(errors(ok), []);
  assert.match(suggestedVatNote("eu", [{ type: "service" }]), /Omvänd betalningsskyldighet/);
  assert.match(suggestedVatNote("reverse_domestic"), /Omvänd betalningsskyldighet/);
});

test("ej momsregistrerat företag får inte debitera moms", () => {
  const s = { ...seller, vatRegistered: false, vatNumber: "" };
  assert.ok(errors(base({ seller: s })).includes("vat"));
  assert.deepEqual(errors(base({ seller: s, lines: [line(100000, 0)] })), []);
});

test("förenklad faktura bara upp till 4 000 kr inkl. moms och utan kundadress", () => {
  const noAddress = { ...buyer, address: "", postalCode: "", city: "" };
  assert.ok(errors(base({ buyer: noAddress })).includes("customer.address"));
  assert.deepEqual(errors(base({ buyer: noAddress, lines: [line(320000, 25)] }, { simplified: true })), []); // 4 000 kr inkl. moms
  assert.ok(errors(base({ buyer: noAddress, lines: [line(320001, 25)] }, { simplified: true })).includes("simplified"));
});

test("datumlogik och tjänsteperiod", () => {
  assert.ok(errors(base({}, { dueDate: "2026-10-01" })).includes("dueDate"));
  assert.ok(errors(base({ lines: [line(100000, 25, 1, { periodStart: "2026-11-30", periodEnd: "2026-11-01" })] })).includes("lines.0.period"));
  assert.deepEqual(errors(base({ lines: [line(100000, 25, 1, { description: "Webbhotell", periodStart: "2026-11-01", periodEnd: "2026-11-30" })] })), []);
});

test("minst en rad och positivt totalbelopp", () => {
  assert.ok(errors(base({ lines: [] })).includes("lines"));
  assert.ok(errors(base({ lines: [line(-100000, 25)] })).includes("total"));
});

test("Swish-QR: rätt mottagare, belopp och meddelande, och inget kan ändras", () => {
  assert.equal(swishPayload("123 456 78 90", 124950, "Faktura 1042"), "C1234567890;1249.50;Faktura 1042;0");
  assert.equal(swishPayload("1234567890", 100, "a;b\nc"), "C1234567890;1.00;a b c;0");
});
