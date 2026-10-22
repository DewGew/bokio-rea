// Faktura-PDF: flera sidor, alla mallar, kreditfaktura och att ingen text överlappar eller klipps av. Körs med `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { invoicePdf } from "../src/lib/invoice-pdf";
import { invoiceTotals, lineNet } from "../src/lib/invoice-rules";
import type { DocLine, InvoiceDoc } from "../src/lib/invoice-doc";
import type { InvoiceTemplate } from "../src/lib/invoice-design";

const W = 595.28;
const H = 841.89;

function doc(lines: Omit<DocLine, "net">[], patch: Partial<InvoiceDoc> = {}): InvoiceDoc {
  const full = lines.map((l) => ({ ...l, net: lineNet(l) }));
  const t = invoiceTotals(full);
  return {
    version: 1,
    kind: "invoice",
    number: 1042,
    status: "sent",
    date: "2026-10-22",
    dueDate: "2026-11-21",
    deliveryDate: "2026-10-20",
    issuedAt: "2026-10-22T10:00:00.000Z",
    currency: "SEK",
    ourReference: "Anna Säljare",
    theirReference: "Erik Inköpare med ett ganska långt namn",
    notes: "Tack för förtroendet!",
    vatTreatment: "standard",
    vatNote: "",
    simplified: false,
    creditOf: null,
    seller: {
      name: "Testbolaget Aktiebolag",
      tradeName: "Testbolaget",
      orgNumber: "556677-8899",
      vatNumber: "SE556677889901",
      address: "Långgatan 123, 4 tr",
      postalCode: "111 22",
      city: "Stockholm",
      seat: "Stockholm",
      companyType: "ab",
      phone: "08-123 456 78",
      email: "faktura@testbolaget.test",
      website: "www.testbolaget.test",
      fSkatt: true,
      vatRegistered: true,
    },
    buyer: {
      name: "Kunden med ett mycket långt företagsnamn Aktiebolag",
      orgNumber: "556074-3089",
      vatNumber: "SE556074308901",
      address: "Industrivägen 45",
      postalCode: "405 31",
      city: "Göteborg",
      country: "SE",
      reference: "Eva Ekonomi",
      email: "faktura@kunden.test",
    },
    payment: {
      bankgiro: "123-4567",
      plusgiro: "12 34 56-7",
      iban: "SE45 5000 0000 0583 9825 7466",
      bic: "ESSESESS",
      swishNumber: "1234567890",
      swishQr: true,
      paymentLink: "https://betala.testbolaget.test/faktura/1042",
      termsDays: 30,
      lateInterest: "Vid betalning efter förfallodagen debiteras dröjsmålsränta enligt räntelagen.",
      reminderFee: "Vid påminnelse debiteras en påminnelseavgift på 60 kr enligt avtal.",
    },
    lines: full,
    totals: { net: t.net, vat: t.vat, total: t.total, discount: t.discount, byRate: [...t.byRate.entries()].map(([rate, v]) => ({ rate, net: v.net, vat: v.vat })) },
    footer: "Egen sidfot: Organisationen är medlem i Exempelförbundet.",
    ...patch,
  };
}

const design = (template: InvoiceTemplate) => ({ template, color: "#0071e3", footer: "", swishNumber: "", swishQr: false, paymentLink: "", showLogo: false });

type Item = { str: string; x: number; y: number; w: number; h: number; page: number };

async function textItems(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  const items: Item[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const [, , , d, e, f] = it.transform as number[];
      items.push({ str: it.str, x: e, y: f, w: it.width, h: Math.abs(d), page: p });
    }
  }
  return { pages: pdf.numPages, items };
}

/** Ingen text utanför sidans marginaler, och inga textrutor som överlappar varandra. */
function assertLayout(items: Item[], label: string) {
  for (const it of items) {
    assert.ok(it.x >= 20 && it.x + it.w <= W - 20, `${label}: "${it.str}" sticker ut horisontellt (x=${it.x.toFixed(1)}, b=${it.w.toFixed(1)})`);
    assert.ok(it.y >= 10 && it.y + it.h <= H - 10, `${label}: "${it.str}" sticker ut vertikalt (y=${it.y.toFixed(1)})`);
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.page !== b.page) continue;
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h * 0.75, b.y + b.h * 0.75) - Math.max(a.y, b.y);
      assert.ok(!(overlapX > 1 && overlapY > 1), `${label}: "${a.str}" och "${b.str}" överlappar på sida ${a.page}`);
    }
  }
}

const many = Array.from({ length: 70 }, (_, i) => ({
  description: i % 7 === 0 ? `Rad ${i + 1}: en lång beskrivning av utfört arbete som behöver brytas över flera rader för att få plats i kolumnen, inklusive en lång länk https://exempel.test/ett/mycket/langt/sokvag/som/maste/delas` : `Konsulttimme ${i + 1}`,
  quantity: (i % 5) + 1.5,
  unit: "tim",
  unitPrice: 95000 + i * 1000,
  vatRate: [25, 12, 6, 0][i % 4],
  discountBp: i % 3 === 0 ? 1000 : 0,
  type: i % 2 ? "goods" : "service",
  periodStart: i % 10 === 0 ? "2026-11-01" : null,
  periodEnd: i % 10 === 0 ? "2026-11-30" : null,
}));

for (const template of ["modern", "klassisk", "minimal", "elegant"] as InvoiceTemplate[]) {
  test(`mall ${template}: många rader ger flera A4-sidor utan överlapp eller avklippt text`, async () => {
    const bytes = await invoicePdf(doc(many, { vatNote: "Rader med 0 % moms: undantagen från skatteplikt enligt 10 kap. mervärdesskattelagen." }), design(template), null);
    const { pages, items } = await textItems(bytes);
    assert.ok(pages >= 3, `förväntade flera sidor, fick ${pages}`);
    assertLayout(items, template);
    const all = items.map((i) => i.str).join(" ");
    assert.match(all, new RegExp(`Sida ${pages} av ${pages}`));
    assert.match(all, /forts\./);
    assert.match(all, /ATT BETALA/);
  });
}

test("en kort faktura får plats på en sida och innehåller lagstadgade uppgifter", async () => {
  const bytes = await invoicePdf(
    doc([{ description: "Webbhotell, abonnemang", quantity: 1, unit: "mån", unitPrice: 19900, vatRate: 25, discountBp: 0, type: "service", periodStart: "2026-11-01", periodEnd: "2026-11-30" }]),
    design("modern"),
    null,
  );
  const { pages, items } = await textItems(bytes);
  assert.equal(pages, 1);
  assertLayout(items, "kort");
  const all = items.map((i) => i.str).join(" ");
  for (const s of [
    "FAKTURA",
    "1042",
    "Fakturadatum",
    "2026-10-22",
    "Förfallodatum",
    "Leveransdatum",
    "Org.nr 556677-8899",
    "Momsreg.nr SE556677889901",
    "Styrelsens säte: Stockholm",
    "Godkänd för F-skatt",
    "Momsreg.nr SE556074308901", // köparens momsnummer
    "Period 2026-11-01 – 2026-11-30",
    "Moms 25 % på 199,00",
    "ATT BETALA",
    "248,75 kr",
    "Bankgiro",
    "dröjsmålsränta",
    "Betalningsmottagare",
  ]) {
    assert.ok(all.includes(s), `saknar "${s}"`);
  }
});

test("F-skatt och säte visas bara när de gäller", async () => {
  const base = doc([{ description: "Tjänst", quantity: 1, unit: "st", unitPrice: 10000, vatRate: 25, discountBp: 0, type: "service", periodStart: null, periodEnd: null }]);
  const bytes = await invoicePdf({ ...base, seller: { ...base.seller, fSkatt: false, companyType: "ef", seat: "" } }, design("klassisk"), null);
  const all = (await textItems(bytes)).items.map((i) => i.str).join(" ");
  assert.ok(!all.includes("F-skatt"));
  assert.ok(!all.includes("säte"));
});

test("kreditfaktura: negativa belopp, hänvisning till originalet och ingen betalningsruta", async () => {
  const credit = doc(
    [{ description: "Konsulttimme", quantity: -2, unit: "tim", unitPrice: 95000, vatRate: 25, discountBp: 0, type: "service", periodStart: null, periodEnd: null }],
    { kind: "credit", number: 1043, creditOf: { number: 1042, date: "2026-10-01" } },
  );
  const bytes = await invoicePdf(credit, design("elegant"), null);
  const { items } = await textItems(bytes);
  assertLayout(items, "kredit");
  const all = items.map((i) => i.str).join(" ");
  assert.match(all, /Kreditfaktura/);
  assert.match(all, /Avser faktura/);
  assert.match(all, /-2 375,00 kr/);
  assert.ok(!all.includes("Betalningsmottagare"));
  assert.ok(!all.includes("Skanna med Swish"));
});

test("omvänd betalningsskyldighet: fakturatexten syns", async () => {
  const d = doc([{ description: "Byggtjänst", quantity: 10, unit: "tim", unitPrice: 50000, vatRate: 0, discountBp: 0, type: "service", periodStart: null, periodEnd: null }], {
    vatTreatment: "reverse_domestic",
    vatNote: "Omvänd betalningsskyldighet",
  });
  const all = (await textItems(await invoicePdf(d, design("minimal"), null))).items.map((i) => i.str).join(" ");
  assert.match(all, /Omvänd betalningsskyldighet/);
  assert.match(all, /Moms 0 % på 5 000,00/);
});
