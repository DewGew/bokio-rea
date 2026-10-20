import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Company, Customer, Invoice, InvoiceLine } from "@prisma/client";
import { invoiceTotals } from "./accounting";
import { dateStr } from "./money";

// Standardtypsnitten använder WinAnsi, som klarar å, ä, ö och é men inte t.ex. U+2212 eller smala mellanslag.
const clean = (s: string) =>
  s
    .replace(/[  ]/g, " ")
    .replace(/−/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, "?");

const money = (ore: number) =>
  clean((ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const INK = rgb(0.11, 0.14, 0.13);
const MUTED = rgb(0.4, 0.44, 0.42);
const LINE = rgb(0.85, 0.85, 0.83);
const BRAND = rgb(0.12, 0.44, 0.33);

type Full = Invoice & { customer: Customer; lines: InvoiceLine[] };

export async function invoicePdf(invoice: Full, company: Company) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Faktura ${invoice.number ?? "utkast"} - ${company.name}`);
  pdf.setAuthor(company.name);
  pdf.setCreator("Huvudbok");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const W = 595.28;
  const H = 841.89;
  const M = 50;
  let page = pdf.addPage([W, H]);
  let y = H - M;

  const text = (p: PDFPage, s: string, x: number, yy: number, o: { size?: number; f?: PDFFont; color?: typeof INK; align?: "left" | "right" } = {}) => {
    const size = o.size ?? 9.5;
    const f = o.f ?? font;
    const str = clean(s);
    const w = f.widthOfTextAtSize(str, size);
    p.drawText(str, { x: o.align === "right" ? x - w : x, y: yy, size, font: f, color: o.color ?? INK });
  };
  /** Radbryter text till given bredd. */
  const wrap = (s: string, width: number, size = 9.5, f = font) => {
    const out: string[] = [];
    for (const para of clean(s).split("\n")) {
      let line = "";
      for (const word of para.split(" ")) {
        const test = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(test, size) > width && line) {
          out.push(line);
          line = word;
        } else line = test;
      }
      out.push(line);
    }
    return out;
  };

  // Sidhuvud
  text(page, company.name, M, y, { size: 16, f: bold });
  text(page, invoice.status === "credited" ? "FAKTURA (KREDITERAD)" : invoice.status === "draft" ? "FAKTURA (UTKAST)" : "FAKTURA", W - M, y, { size: 16, f: bold, color: BRAND, align: "right" });
  y -= 18;
  for (const l of [company.address, `${company.postalCode} ${company.city}`.trim(), company.email].filter(Boolean)) {
    text(page, l, M, y, { color: MUTED });
    y -= 12;
  }

  const meta: [string, string][] = [
    ["Fakturanummer", invoice.number ? String(invoice.number) : "-"],
    ["Fakturadatum", dateStr(invoice.date)],
    ["Förfallodatum", dateStr(invoice.dueDate)],
  ];
  if (invoice.ourReference) meta.push(["Vår referens", invoice.ourReference]);
  if (invoice.theirReference) meta.push(["Er referens", invoice.theirReference]);
  let my = H - M - 18;
  for (const [k, v] of meta) {
    text(page, k, W - M - 150, my, { color: MUTED });
    text(page, v, W - M, my, { f: bold, align: "right" });
    my -= 13;
  }

  // Kundadress
  y = Math.min(y, my) - 24;
  const c = invoice.customer;
  const boxTop = y + 4;
  const custLines = [c.address, `${c.postalCode} ${c.city}`.trim(), c.orgNumber ? `Org.nr ${c.orgNumber}` : ""].filter(Boolean);
  const boxH = 22 + custLines.length * 12;
  page.drawRectangle({ x: W / 2, y: boxTop - boxH, width: W / 2 - M, height: boxH, borderColor: LINE, borderWidth: 1 });
  text(page, c.name, W / 2 + 12, boxTop - 16, { f: bold });
  custLines.forEach((l, i) => text(page, l, W / 2 + 12, boxTop - 30 - i * 12));
  y = boxTop - boxH - 30;

  // Rader
  const cols = { desc: M, qty: 340, price: 420, vat: 465, sum: W - M };
  const header = () => {
    text(page, "Beskrivning", cols.desc, y, { f: bold, size: 8.5, color: MUTED });
    text(page, "Antal", cols.qty, y, { f: bold, size: 8.5, color: MUTED, align: "right" });
    text(page, "À-pris", cols.price, y, { f: bold, size: 8.5, color: MUTED, align: "right" });
    text(page, "Moms", cols.vat, y, { f: bold, size: 8.5, color: MUTED, align: "right" });
    text(page, "Belopp", cols.sum, y, { f: bold, size: 8.5, color: MUTED, align: "right" });
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: LINE });
    y -= 14;
  };
  header();
  for (const l of invoice.lines) {
    const desc = wrap(l.description, cols.qty - cols.desc - 60);
    if (y - desc.length * 12 < 170) {
      page = pdf.addPage([W, H]);
      y = H - M;
      header();
    }
    text(page, desc[0], cols.desc, y);
    text(page, `${l.quantity.toLocaleString("sv-SE")} ${l.unit}`, cols.qty, y, { align: "right" });
    text(page, money(l.unitPrice), cols.price, y, { align: "right" });
    text(page, `${l.vatRate} %`, cols.vat, y, { align: "right" });
    text(page, money(Math.round(l.quantity * l.unitPrice)), cols.sum, y, { align: "right" });
    for (const extra of desc.slice(1)) {
      y -= 12;
      text(page, extra, cols.desc, y);
    }
    y -= 8;
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.4, color: LINE });
    y -= 12;
  }

  // Summering
  const t = invoiceTotals(invoice.lines);
  y -= 6;
  const sumRow = (k: string, v: string, f = font, size = 9.5) => {
    text(page, k, W - M - 200, y, { f, size });
    text(page, v, W - M, y, { f, size, align: "right" });
    y -= size + 5;
  };
  sumRow("Belopp exkl. moms", `${money(t.net)} kr`);
  for (const [rate, v] of t.byRate) if (rate > 0) sumRow(`Moms ${rate} % (på ${money(v.net)})`, `${money(v.vat)} kr`);
  y -= 2;
  page.drawLine({ start: { x: W - M - 200, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.8, color: INK });
  y -= 4;
  sumRow("Att betala", `${money(t.total)} kr`, bold, 12);

  if (invoice.notes) {
    y -= 14;
    for (const l of wrap(invoice.notes, W - 2 * M)) {
      text(page, l, M, y, { color: MUTED });
      y -= 12;
    }
  }

  // Sidfot med betalnings- och företagsuppgifter
  const fy = 110;
  page.drawLine({ start: { x: M, y: fy + 16 }, end: { x: W - M, y: fy + 16 }, thickness: 0.6, color: LINE });
  const colW = (W - 2 * M) / 3;
  const footer: [string, string[]][] = [
    ["Betalning", [company.bankgiro ? `Bankgiro ${company.bankgiro}` : "", `Ange fakturanummer ${invoice.number ?? ""} som referens`, `Förfallodatum ${dateStr(invoice.dueDate)}`].filter(Boolean)],
    ["Företagsuppgifter", [`Org.nr ${company.orgNumber}`, company.vatNumber ? `Momsreg.nr ${company.vatNumber}` : "", "Godkänd för F-skatt"].filter(Boolean)],
    ["Kontakt", [company.email, "Vid sen betalning debiteras", "dröjsmålsränta enligt räntelagen."].filter(Boolean)],
  ];
  footer.forEach(([title, lines], i) => {
    const x = M + i * colW;
    text(page, title, x, fy, { f: bold, size: 8.5 });
    lines.forEach((l, j) => text(page, l, x, fy - 12 - j * 11, { size: 8, color: MUTED }));
  });

  const pages = pdf.getPages();
  if (pages.length > 1) pages.forEach((p, i) => text(p, `Sida ${i + 1} av ${pages.length}`, W - M, 30, { size: 8, color: MUTED, align: "right" }));

  return pdf.save();
}
