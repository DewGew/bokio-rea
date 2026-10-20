import "server-only";
import { PDFDocument, PDFString, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import QRCode from "qrcode";
import type { Company, Customer, Invoice, InvoiceLine } from "@prisma/client";
import { invoiceTotals } from "./accounting";
import { safeLink, swishDigits, validSwish, type InvoiceDesign, type InvoiceTemplate } from "./invoice-design";
import { dateStr } from "./money";

// Standardtypsnitten använder WinAnsi, som klarar å, ä, ö och é men inte t.ex. U+2212 eller smala mellanslag.
const clean = (s: string) =>
  s
    .replace(/[  ]/g, " ")
    .replace(/−/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, "?");

const money = (ore: number) => clean((ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

type Full = Invoice & { customer: Customer; lines: InvoiceLine[] };
export type Logo = { bytes: Uint8Array; mime: string } | null;

const W = 595.28;
const H = 841.89;
const M = 48;
const INK = rgb(0.11, 0.11, 0.12);
const MUTED = rgb(0.43, 0.43, 0.45);
const HAIR = rgb(0.88, 0.88, 0.9);
const WHITE = rgb(1, 1, 1);

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
const mix = (c: RGB, t: number): RGB => rgb(c.red + (1 - c.red) * t, c.green + (1 - c.green) * t, c.blue + (1 - c.blue) * t);
const darken = (c: RGB, k: number): RGB => rgb(c.red * k, c.green * k, c.blue * k);
const luminance = (c: RGB) => 0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue;

export async function invoicePdf(invoice: Full, company: Company, design: InvoiceDesign, logo: Logo) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Faktura ${invoice.number ?? "utkast"} - ${company.name}`);
  pdf.setAuthor(company.name);
  pdf.setCreator("Huvudbok");
  pdf.setLanguage("sv-SE");

  const f = {
    sans: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    serif: await pdf.embedFont(StandardFonts.TimesRoman),
    serifBold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    serifItalic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
  };
  const tpl: InvoiceTemplate = design.template;
  const accent = hexToRgb(design.color);
  const onAccent = luminance(accent) > 0.62 ? INK : WHITE;
  const tint = mix(accent, 0.93);
  // För mycket ljusa färger används en mörkare variant till text och linjer.
  const accentText = luminance(accent) > 0.62 ? darken(accent, 0.55) : accent;
  const heading = tpl === "elegant" ? f.serifBold : f.bold;

  let logoImg: PDFImage | null = null;
  if (logo && design.showLogo) {
    try {
      logoImg = logo.mime === "image/png" ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes);
    } catch {
      logoImg = null;
    }
  }

  const pages: PDFPage[] = [];
  const newPage = () => {
    const p = pdf.addPage([W, H]);
    pages.push(p);
    if (tpl === "elegant") p.drawRectangle({ x: 0, y: 0, width: 10, height: H, color: accent });
    return p;
  };
  let page = newPage();

  // ---------- Ritverktyg ----------
  type TextOpt = { size?: number; font?: PDFFont; color?: RGB; align?: "left" | "right" | "center"; p?: PDFPage };
  const text = (s: string, x: number, y: number, o: TextOpt = {}) => {
    const size = o.size ?? 9.5;
    const font = o.font ?? f.sans;
    const str = clean(s);
    const w = font.widthOfTextAtSize(str, size);
    const dx = o.align === "right" ? -w : o.align === "center" ? -w / 2 : 0;
    (o.p ?? page).drawText(str, { x: x + dx, y, size, font, color: o.color ?? INK });
    return w;
  };
  const wrap = (s: string, width: number, size = 9.5, font = f.sans) => {
    const out: string[] = [];
    for (const para of clean(s).split("\n")) {
      let line = "";
      for (const word of para.split(" ")) {
        const test = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(test, size) > width && line) {
          out.push(line);
          line = word;
        } else line = test;
      }
      out.push(line);
    }
    return out;
  };
  const roundRect = (x: number, y: number, w: number, h: number, r: number, color: RGB, p = page) => {
    r = Math.min(r, h / 2, w / 2);
    const path = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
    p.drawSvgPath(path, { x, y: y + h, color, borderWidth: 0 });
  };
  const hair = (x1: number, x2: number, y: number, color = HAIR, thickness = 0.6) =>
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  const label = (s: string, x: number, y: number, align: "left" | "right" = "left") =>
    text(tpl === "minimal" ? s.toUpperCase() : s, x, y, { size: tpl === "minimal" ? 7 : 8, color: MUTED, align, font: tpl === "minimal" ? f.bold : f.sans });
  const drawLogo = (x: number, yTop: number, maxW: number, maxH: number, p = page) => {
    if (!logoImg) return 0;
    const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height, 1);
    const w = logoImg.width * scale;
    const h = logoImg.height * scale;
    p.drawImage(logoImg, { x, y: yTop - h, width: w, height: h });
    return h;
  };
  const link = (url: string, x: number, y: number, w: number, h: number) => {
    const annot = pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x, y, x + w, y + h],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
    });
    page.node.addAnnot(pdf.context.register(annot));
  };

  const t = invoiceTotals(invoice.lines);
  const c = invoice.customer;
  const number = invoice.number ? String(invoice.number) : "Utkast";
  const title = invoice.status === "credited" ? "Kreditfaktura" : "Faktura";
  const companyLines = [company.address, `${company.postalCode} ${company.city}`.trim(), company.phone, company.email, company.website].filter(Boolean);
  const customerLines = [c.address, `${c.postalCode} ${c.city}`.trim(), c.orgNumber ? `Org.nr ${c.orgNumber}` : "", c.reference ? `Att: ${c.reference}` : ""].filter(Boolean);
  const meta: [string, string][] = [
    ["Fakturanummer", number],
    ["Fakturadatum", dateStr(invoice.date)],
    ["Förfallodatum", dateStr(invoice.dueDate)],
  ];
  if (invoice.ourReference) meta.push(["Vår referens", invoice.ourReference]);
  if (invoice.theirReference) meta.push(["Er referens", invoice.theirReference]);

  let y = H - M;

  // ---------- Sidhuvud ----------
  if (tpl === "modern") {
    const bandH = 118;
    page.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: accent });
    if (logoImg) {
      const maxW = 150;
      const maxH = 46;
      const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height, 1);
      roundRect(M - 10, H - 40 - logoImg.height * scale - 10, logoImg.width * scale + 20, logoImg.height * scale + 20, 10, WHITE);
      drawLogo(M, H - 40, maxW, maxH);
    } else {
      text(company.name, M, H - 64, { size: 18, font: f.bold, color: onAccent });
    }
    text(title.toUpperCase(), W - M, H - 58, { size: 22, font: f.bold, color: onAccent, align: "right" });
    text(`Nr ${number}`, W - M, H - 78, { size: 11, color: onAccent, align: "right" });
    y = H - bandH - 34;
    // Nyckeltal i en rad
    const cols: [string, string][] = [
      ["Fakturadatum", dateStr(invoice.date)],
      ["Förfallodatum", dateStr(invoice.dueDate)],
      ["Att betala", `${money(t.total)} kr`],
    ];
    const cw = (W - 2 * M) / cols.length;
    cols.forEach(([k, v], i) => {
      label(k, M + i * cw, y);
      text(v, M + i * cw, y - 16, { size: 13, font: f.bold, color: i === 2 ? accentText : INK });
    });
    y -= 42;
    hair(M, W - M, y);
    y -= 26;
    // Från / Till
    const half = (W - 2 * M) / 2;
    label("Från", M, y);
    label("Faktureras till", M + half, y);
    text(company.name, M, y - 15, { font: f.bold, size: 10.5 });
    text(c.name, M + half, y - 15, { font: f.bold, size: 10.5 });
    companyLines.forEach((l, i) => text(l, M, y - 29 - i * 12.5, { color: MUTED }));
    customerLines.forEach((l, i) => text(l, M + half, y - 29 - i * 12.5));
    y -= 29 + Math.max(companyLines.length, customerLines.length) * 12.5 + 6;
    const refs = meta.slice(3);
    if (refs.length) {
      y -= 6;
      refs.forEach(([k, v], i) => {
        label(k, M + i * half, y);
        text(v, M + i * half, y - 13);
      });
      y -= 40;
    }
  } else if (tpl === "klassisk") {
    const logoH = drawLogo(M, y, 170, 58);
    if (!logoH) text(company.name, M, y - 18, { size: 18, font: f.bold });
    let ly = y - (logoH || 22) - 14;
    if (logoH) {
      text(company.name, M, ly, { font: f.bold });
      ly -= 12.5;
    }
    companyLines.forEach((l) => {
      text(l, M, ly, { color: MUTED, size: 8.5 });
      ly -= 11.5;
    });
    text(title, W - M, y - 22, { size: 26, font: f.bold, color: accentText, align: "right" });
    let my = y - 46;
    for (const [k, v] of meta) {
      text(k, W - M - 110, my, { color: MUTED, size: 8.5, align: "right" });
      text(v, W - M, my, { font: f.bold, size: 9, align: "right" });
      my -= 13;
    }
    y = Math.min(ly, my) - 10;
    page.drawRectangle({ x: M, y, width: W - 2 * M, height: 2, color: accent });
    y -= 28;
    label("Faktureras till", M, y);
    text(c.name, M, y - 15, { font: f.bold, size: 11 });
    customerLines.forEach((l, i) => text(l, M, y - 29 - i * 12.5));
    y -= 29 + customerLines.length * 12.5 + 14;
  } else if (tpl === "minimal") {
    page.drawRectangle({ x: M, y: y - 3, width: 28, height: 3, color: accent });
    y -= 22;
    const logoH = drawLogo(M, y, 120, 40);
    if (!logoH) text(company.name, M, y - 12, { size: 13, font: f.bold });
    text(`${title} ${number}`, W - M, y - 12, { size: 13, color: MUTED, align: "right" });
    y -= Math.max(logoH, 16) + 30;
    const third = (W - 2 * M) / 3;
    label("Från", M, y);
    label("Till", M + third, y);
    label("Detaljer", M + 2 * third, y);
    text(company.name, M, y - 15, { font: f.bold });
    text(c.name, M + third, y - 15, { font: f.bold });
    companyLines.forEach((l, i) => text(l, M, y - 28 - i * 12, { color: MUTED, size: 8.5 }));
    customerLines.forEach((l, i) => text(l, M + third, y - 28 - i * 12, { size: 8.5 }));
    meta.forEach(([k, v], i) => {
      text(k, M + 2 * third, y - 15 - i * 12, { color: MUTED, size: 8.5 });
      text(v, W - M, y - 15 - i * 12, { size: 8.5, align: "right" });
    });
    y -= 28 + Math.max(companyLines.length, customerLines.length, meta.length) * 12 + 22;
  } else {
    // elegant
    const logoH = drawLogo(M + 6, y, 160, 56);
    text(title, W - M, y - 26, { size: 32, font: f.serifBold, align: "right" });
    text(`Nummer ${number}`, W - M, y - 44, { size: 10.5, font: f.serifItalic, color: MUTED, align: "right" });
    y -= Math.max(logoH, 52) + 22;
    if (!logoH) {
      text(company.name, M + 6, y + 30, { size: 16, font: f.serifBold, color: accentText });
    }
    hair(M + 6, W - M, y, accent, 0.8);
    y -= 26;
    const half = (W - 2 * M - 6) / 2;
    const x0 = M + 6;
    text("Från", x0, y, { font: f.serifItalic, size: 10, color: MUTED });
    text("Till", x0 + half, y, { font: f.serifItalic, size: 10, color: MUTED });
    text(company.name, x0, y - 16, { font: f.serifBold, size: 12 });
    text(c.name, x0 + half, y - 16, { font: f.serifBold, size: 12 });
    companyLines.forEach((l, i) => text(l, x0, y - 30 - i * 12.5, { color: MUTED }));
    customerLines.forEach((l, i) => text(l, x0 + half, y - 30 - i * 12.5));
    y -= 30 + Math.max(companyLines.length, customerLines.length) * 12.5 + 12;
    meta.slice(1).forEach(([k, v], i) => {
      const x = x0 + (i % 2) * half;
      const yy = y - Math.floor(i / 2) * 15;
      text(`${k}:`, x, yy, { font: f.serifItalic, color: MUTED });
      text(v, x + 78, yy, { font: f.sans });
    });
    y -= Math.ceil((meta.length - 1) / 2) * 15 + 16;
  }

  // ---------- Fakturarader ----------
  const left = tpl === "elegant" ? M + 6 : M;
  const cols = { desc: left + (tpl === "modern" ? 10 : 0), qty: 352, price: 432, vat: 478, sum: W - M - (tpl === "modern" ? 10 : 0) };
  const header = () => {
    const color = tpl === "modern" ? accentText : tpl === "minimal" ? MUTED : INK;
    const font = tpl === "elegant" ? f.serifBold : f.bold;
    const size = tpl === "minimal" ? 7 : 8.5;
    const up = (s: string) => (tpl === "minimal" ? s.toUpperCase() : s);
    if (tpl === "modern") roundRect(left, y - 8, W - M - left, 24, 6, tint);
    text(up("Beskrivning"), cols.desc, y, { font, size, color });
    text(up("Antal"), cols.qty, y, { font, size, color, align: "right" });
    text(up("À-pris"), cols.price, y, { font, size, color, align: "right" });
    text(up("Moms"), cols.vat, y, { font, size, color, align: "right" });
    text(up("Belopp"), cols.sum, y, { font, size, color, align: "right" });
    y -= 10;
    if (tpl === "klassisk") page.drawRectangle({ x: left, y, width: W - M - left, height: 1.2, color: accent });
    else if (tpl !== "modern") hair(left, W - M, y);
    y -= 16;
  };
  header();
  for (const l of invoice.lines) {
    const desc = wrap(l.description, cols.qty - cols.desc - 70);
    if (y - desc.length * 12 < 200) {
      page = newPage();
      y = H - M - 10;
      header();
    }
    text(desc[0], cols.desc, y);
    text(`${l.quantity.toLocaleString("sv-SE")} ${l.unit}`, cols.qty, y, { align: "right" });
    text(money(l.unitPrice), cols.price, y, { align: "right" });
    text(`${l.vatRate} %`, cols.vat, y, { align: "right", color: MUTED });
    text(money(Math.round(l.quantity * l.unitPrice)), cols.sum, y, { align: "right" });
    for (const extra of desc.slice(1)) {
      y -= 12;
      text(extra, cols.desc, y);
    }
    y -= 9;
    hair(left, W - M, y + 1);
    y -= 13;
  }

  // ---------- Summering ----------
  y -= 4;
  const sx = W - M - 220;
  const row = (k: string, v: string) => {
    text(k, sx, y, { color: MUTED });
    text(v, W - M, y, { align: "right" });
    y -= 15;
  };
  row("Belopp exkl. moms", `${money(t.net)} kr`);
  for (const [rate, v] of t.byRate) if (rate > 0) row(`Moms ${rate} %`, `${money(v.vat)} kr`);
  // Luft mellan momsraderna och totalsumman (som i vissa mallar ligger i en färgad ruta).
  y -= tpl === "modern" || tpl === "elegant" ? 16 : 4;
  const totalLabel = invoice.status === "credited" ? "Krediterat belopp" : "Att betala";
  if (tpl === "modern") {
    roundRect(sx - 12, y - 12, W - M - sx + 12, 32, 8, accent);
    text(totalLabel, sx, y, { font: f.bold, size: 11, color: onAccent });
    text(`${money(t.total)} kr`, W - M - 10, y, { font: f.bold, size: 13, color: onAccent, align: "right" });
    y -= 30;
  } else if (tpl === "elegant") {
    roundRect(sx - 12, y - 16, W - M - sx + 12, 38, 6, tint);
    text(totalLabel, sx, y, { font: f.serifBold, size: 13, color: accentText });
    text(`${money(t.total)} kr`, W - M - 10, y, { font: f.serifBold, size: 16, color: accentText, align: "right" });
    y -= 34;
  } else if (tpl === "minimal") {
    hair(sx, W - M, y + 10);
    text(totalLabel, sx, y - 6, { font: f.bold, size: 10 });
    text(`${money(t.total)} kr`, W - M, y - 8, { font: f.bold, size: 18, color: accentText, align: "right" });
    y -= 32;
  } else {
    page.drawLine({ start: { x: sx, y: y + 10 }, end: { x: W - M, y: y + 10 }, thickness: 1, color: INK });
    text(totalLabel, sx, y - 4, { font: f.bold, size: 11.5 });
    text(`${money(t.total)} kr`, W - M, y - 4, { font: f.bold, size: 13, align: "right" });
    y -= 26;
  }

  if (invoice.notes) {
    y -= 8;
    for (const l of wrap(invoice.notes, W - M - left)) {
      text(l, left, y, { color: MUTED });
      y -= 12;
    }
  }

  // ---------- Betalningsinformation ----------
  const swish = design.swishNumber && validSwish(design.swishNumber) ? swishDigits(design.swishNumber) : "";
  const showQr = !!swish && design.swishQr && invoice.status !== "credited";
  const payLink = invoice.status !== "credited" ? safeLink(design.paymentLink) : "";
  const payRows: [string, string][] = [];
  if (company.bankgiro) payRows.push(["Bankgiro", company.bankgiro]);
  if (company.plusgiro) payRows.push(["Plusgiro", company.plusgiro]);
  if (company.iban) payRows.push(["IBAN", company.iban]);
  if (company.bic) payRows.push(["BIC", company.bic]);
  if (swish) payRows.push(["Swish", swish.replace(/^(\d{3})(\d{3})(\d{2})(\d{2})$/, "$1 $2 $3 $4")]);
  payRows.push(["Referens", invoice.number ? String(invoice.number) : "-"]);

  const boxH = Math.max(payRows.length * 13 + 44 + (payLink ? 16 : 0), showQr ? 128 : 0);
  if (y - boxH < 96) {
    page = newPage();
    y = H - M;
  }
  y -= 14;
  const bx = left;
  const bw = W - M - left;
  const top = y;
  if (tpl === "modern" || tpl === "elegant") roundRect(bx, top - boxH, bw, boxH, 10, tpl === "modern" ? tint : rgb(0.97, 0.97, 0.975));
  else hair(bx, W - M, top);
  const px = tpl === "modern" || tpl === "elegant" ? bx + 16 : bx;
  let py = top - 22;
  text("Betalningsinformation", px, py, { font: heading, size: tpl === "elegant" ? 12 : 10.5, color: tpl === "modern" ? accentText : INK });
  py -= 18;
  text(`Betala ${money(t.total)} kr senast ${dateStr(invoice.dueDate)}.`, px, py, { size: 9 });
  py -= 16;
  for (const [k, v] of payRows) {
    text(k, px, py, { color: MUTED, size: 8.5 });
    text(v, px + 70, py, { font: f.bold, size: 9 });
    py -= 13;
  }
  if (payLink) {
    const linkText = "Betala online »";
    const w = text(linkText, px, py - 3, { font: f.bold, size: 9.5, color: accentText });
    link(payLink, px, py - 6, w, 14);
  }
  if (showQr) {
    const amount = (t.total / 100).toFixed(2);
    const message = `Faktura ${invoice.number ?? ""}`.trim().slice(0, 50);
    // Swish QR-format för förifylld betalning: C<nummer>;<belopp>;<meddelande>;<låsta fält (0 = inget redigerbart)>
    const qrText = `C${swish};${amount};${message};0`;
    const png = await QRCode.toBuffer(qrText, { type: "png", errorCorrectionLevel: "M", margin: 1, width: 360 });
    const qr = await pdf.embedPng(png);
    const size = 92;
    const qx = bx + bw - size - 16;
    const qy = top - 16 - size;
    page.drawImage(qr, { x: qx, y: qy, width: size, height: size });
    text("Skanna med Swish", qx + size / 2, qy - 11, { size: 7.5, color: MUTED, align: "center" });
  }
  y = top - boxH;

  // ---------- Sidfot på varje sida ----------
  const legal = [company.name, `Org.nr ${company.orgNumber}`, company.vatNumber ? `Momsreg.nr ${company.vatNumber}` : "", "Godkänd för F-skatt"].filter(Boolean).join("  ·  ");
  const footerText = design.footer.trim() || "Vid betalning efter förfallodagen debiteras dröjsmålsränta enligt räntelagen.";
  pages.forEach((p, i) => {
    const fx = tpl === "elegant" ? M + 6 : M;
    p.drawLine({ start: { x: fx, y: 58 }, end: { x: W - M, y: 58 }, thickness: 0.5, color: HAIR });
    text(legal, fx, 44, { size: 7.5, color: MUTED, p });
    wrap(footerText, W - M - fx - 70, 7.5).slice(0, 2).forEach((l, j) => text(l, fx, 33 - j * 9.5, { size: 7.5, color: MUTED, p }));
    if (pages.length > 1) text(`Sida ${i + 1} av ${pages.length}`, W - M, 33, { size: 7.5, color: MUTED, align: "right", p });
  });

  return pdf.save();
}

/** Plockar ut designinställningarna från företaget, med valfria överskrivningar (förhandsvisning). */
export function designFromCompany(company: Company, override: Partial<InvoiceDesign> = {}): InvoiceDesign {
  return {
    template: (["modern", "klassisk", "minimal", "elegant"].includes(company.invoiceTemplate) ? company.invoiceTemplate : "modern") as InvoiceTemplate,
    color: /^#[0-9a-f]{6}$/i.test(company.invoiceColor) ? company.invoiceColor : "#0071e3",
    footer: company.invoiceFooter,
    swishNumber: company.swishNumber,
    swishQr: company.swishQr,
    paymentLink: company.paymentLink,
    showLogo: true,
    ...override,
  };
}
