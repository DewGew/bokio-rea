import "server-only";
import { PDFDocument, PDFString, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import QRCode from "qrcode";
import type { Company } from "@prisma/client";
import { safeLink, swishDigits, validSwish, type InvoiceDesign, type InvoiceTemplate } from "./invoice-design";
import { countryName, type InvoiceDoc } from "./invoice-doc";
import { swishPayload } from "./invoice-rules";

// Standardtypsnitten använder WinAnsi: å, ä, ö, é, tankstreck, typografiska citattecken och € fungerar,
// men inte t.ex. minustecknet U+2212, pilar eller smala mellanslag.
const clean = (s: string) =>
  s
    .replace(/[\u00a0\u202f\u2009]/g, " ")
    .replace(/\u2212/g, "-")
    .replace(/[^\x20-\x7e\xa0-\xff\n\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac]/g, "?");

const money = (ore: number) => clean((ore / 100 || 0).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const qty = (n: number) => clean(n.toLocaleString("sv-SE", { maximumFractionDigits: 2 }));

export type Logo = { bytes: Uint8Array; mime: string } | null;

const W = 595.28; // A4
const H = 841.89;
const M = 48;
const FOOT = 74; // höjd som sidfoten behöver
const INK = rgb(0.11, 0.11, 0.12);
const MUTED = rgb(0.4, 0.42, 0.46);
const HAIR = rgb(0.87, 0.88, 0.9);
const WHITE = rgb(1, 1, 1);

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
const mix = (c: RGB, t: number): RGB => rgb(c.red + (1 - c.red) * t, c.green + (1 - c.green) * t, c.blue + (1 - c.blue) * t);
const darken = (c: RGB, k: number): RGB => rgb(c.red * k, c.green * k, c.blue * k);
const luminance = (c: RGB) => 0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue;

/**
 * Skapar fakturans PDF (A4) från ett fakturadokument. Innehållet kommer från ögonblicksbilden för utfärdade fakturor;
 * bara utseendet (mall, färg, logotyp) följer de aktuella inställningarna.
 */
export async function invoicePdf(doc: InvoiceDoc, design: InvoiceDesign, logo: Logo) {
  const pdf = await PDFDocument.create();
  const credit = doc.kind === "credit";
  const draft = doc.number == null;
  const title = credit ? "Kreditfaktura" : "Faktura";
  const numberText = draft ? "Utkast" : String(doc.number);
  pdf.setTitle(`${title} ${numberText} - ${doc.seller.name}`);
  pdf.setAuthor(doc.seller.name);
  pdf.setCreator("Kapima Bokför");
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
  const left = tpl === "elegant" ? M + 6 : M;
  const right = W - M;
  const cur = doc.currency === "SEK" ? "kr" : doc.currency;

  let logoImg: PDFImage | null = null;
  if (logo && design.showLogo) {
    try {
      logoImg = logo.mime === "image/png" ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes);
    } catch {
      logoImg = null;
    }
  }

  const pages: PDFPage[] = [];
  let page = undefined as unknown as PDFPage; // sätts av addPage() nedan
  const addPage = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    if (tpl === "elegant") page.drawRectangle({ x: 0, y: 0, width: 10, height: H, color: accent });
    return page;
  };
  addPage();

  // ---------- Ritverktyg ----------
  type TextOpt = { size?: number; font?: PDFFont; color?: RGB; align?: "left" | "right" | "center"; p?: PDFPage };
  const text = (s: string, x: number, y: number, o: TextOpt = {}) => {
    const size = o.size ?? 9;
    const font = o.font ?? f.sans;
    const str = clean(s);
    const w = font.widthOfTextAtSize(str, size);
    const dx = o.align === "right" ? -w : o.align === "center" ? -w / 2 : 0;
    (o.p ?? page).drawText(str, { x: x + dx, y, size, font, color: o.color ?? INK });
    return w;
  };
  /** Radbryter text till en bredd; ord som är längre än bredden (t.ex. länkar) delas. */
  const wrap = (s: string, width: number, size = 9, font = f.sans) => {
    const out: string[] = [];
    for (const para of clean(s).split("\n")) {
      let line = "";
      for (let word of para.split(" ")) {
        while (font.widthOfTextAtSize(word, size) > width && word.length > 1) {
          let cut = word.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > width) cut--;
          if (line) out.push(line);
          out.push(word.slice(0, cut));
          line = "";
          word = word.slice(cut);
        }
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
  const roundRect = (x: number, y: number, w: number, h: number, r: number, color: RGB) => {
    r = Math.min(r, h / 2, w / 2);
    const path = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
    page.drawSvgPath(path, { x, y: y + h, color, borderWidth: 0 });
  };
  const hair = (x1: number, x2: number, y: number, color = HAIR, thickness = 0.6) => page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  const label = (s: string, x: number, y: number, align: "left" | "right" = "left") =>
    text(tpl === "minimal" ? s.toUpperCase() : s, x, y, { size: tpl === "minimal" ? 6.8 : 7.8, color: MUTED, align, font: tpl === "minimal" || tpl === "modern" ? f.bold : tpl === "elegant" ? f.serifItalic : f.sans });
  const drawLogo = (x: number, yTop: number, maxW: number, maxH: number) => {
    if (!logoImg) return 0;
    const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height, 1);
    page.drawImage(logoImg, { x, y: yTop - logoImg.height * scale, width: logoImg.width * scale, height: logoImg.height * scale });
    return logoImg.height * scale;
  };
  const link = (url: string, x: number, y: number, w: number, h: number) => {
    const annot = pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: [x, y, x + w, y + h], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(url) } });
    page.node.addAnnot(pdf.context.register(annot));
  };

  const s = doc.seller;
  const b = doc.buyer;
  const brand = s.tradeName.trim() || s.name;
  let y = H - M;

  // ---------- Sidhuvud (första sidan) ----------
  const headerTitle = `${title.toUpperCase()}${draft ? " (UTKAST)" : ""}`;
  if (tpl === "modern") {
    const bandH = 104;
    page.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: accent });
    if (logoImg) {
      const scale = Math.min(150 / logoImg.width, 44 / logoImg.height, 1);
      roundRect(M - 10, H - 36 - logoImg.height * scale - 10, logoImg.width * scale + 20, logoImg.height * scale + 20, 10, WHITE);
      drawLogo(M, H - 36, 150, 44);
    } else text(brand, M, H - 60, { size: 17, font: f.bold, color: onAccent });
    text(headerTitle, right, H - 54, { size: 20, font: f.bold, color: onAccent, align: "right" });
    text(`Nr ${numberText}`, right, H - 72, { size: 10.5, color: onAccent, align: "right" });
    y = H - bandH - 30;
  } else if (tpl === "klassisk") {
    const logoH = drawLogo(M, y, 170, 54);
    if (!logoH) text(brand, M, y - 18, { size: 17, font: f.bold });
    text(headerTitle, right, y - 20, { size: 22, font: f.bold, color: accentText, align: "right" });
    text(`Nr ${numberText}`, right, y - 38, { size: 10.5, color: MUTED, align: "right" });
    y -= Math.max(logoH, 44) + 14;
    page.drawRectangle({ x: M, y, width: W - 2 * M, height: 2, color: accent });
    y -= 26;
  } else if (tpl === "minimal") {
    page.drawRectangle({ x: M, y: y - 3, width: 28, height: 3, color: accent });
    y -= 20;
    const logoH = drawLogo(M, y, 120, 40);
    if (!logoH) text(brand, M, y - 12, { size: 13, font: f.bold });
    text(`${headerTitle} ${numberText}`, right, y - 12, { size: 12, color: MUTED, align: "right" });
    y -= Math.max(logoH, 16) + 28;
  } else {
    const logoH = drawLogo(left, y, 160, 54);
    text(title + (draft ? " (utkast)" : ""), right, y - 26, { size: 30, font: f.serifBold, align: "right" });
    text(`Nummer ${numberText}`, right, y - 44, { size: 10.5, font: f.serifItalic, color: MUTED, align: "right" });
    if (!logoH) text(brand, left, y - 26, { size: 16, font: f.serifBold, color: accentText });
    y -= Math.max(logoH, 52) + 18;
    hair(left, right, y, accent, 0.8);
    y -= 24;
  }

  // ---------- Säljare, köpare och fakturauppgifter i tre kolumner ----------
  const colW = (right - left - 24) / 3;
  const cx = [left, left + colW + 12, left + 2 * (colW + 12)];
  const sellerLines = [
    ...(s.tradeName.trim() && s.tradeName.trim() !== s.name ? [s.name] : []),
    s.address,
    `${s.postalCode} ${s.city}`.trim(),
    s.phone ? `Tel ${s.phone}` : "",
    s.email,
    s.website,
  ].filter(Boolean);
  const buyerLines = [
    b.address,
    `${b.postalCode} ${b.city}`.trim(),
    b.country && b.country !== "SE" ? countryName(b.country) : "",
    b.orgNumber ? `Org.nr ${b.orgNumber}` : "",
    b.vatNumber ? `Momsreg.nr ${b.vatNumber}` : "",
    b.reference ? `Att: ${b.reference}` : "",
  ].filter(Boolean);
  const meta: [string, string][] = [
    [credit ? "Kreditfakturanr" : "Fakturanummer", numberText],
    ["Fakturadatum", doc.date],
    ...(credit && doc.creditOf ? ([["Avser faktura", `${doc.creditOf.number ?? "-"} (${doc.creditOf.date})`]] as [string, string][]) : []),
    ...(!credit ? ([["Förfallodatum", doc.dueDate]] as [string, string][]) : []),
    ...(doc.deliveryDate && doc.deliveryDate !== doc.date ? ([["Leveransdatum", doc.deliveryDate]] as [string, string][]) : []),
    ...(!credit ? ([["Betalningsvillkor", `${doc.payment.termsDays} dagar`]] as [string, string][]) : []),
    ...(doc.ourReference ? ([["Vår referens", doc.ourReference]] as [string, string][]) : []),
    ...(doc.theirReference ? ([["Er referens", doc.theirReference]] as [string, string][]) : []),
    ...(doc.currency !== "SEK" ? ([["Valuta", doc.currency]] as [string, string][]) : []),
  ];
  const nameFont = tpl === "elegant" ? f.serifBold : f.bold;
  const block = (x: number, heading: string, name: string, lines: string[]) => {
    label(heading, x, y);
    let yy = y - 14;
    for (const l of wrap(name, colW, 10, nameFont)) {
      text(l, x, yy, { font: nameFont, size: 10 });
      yy -= 12.5;
    }
    for (const line of lines) {
      for (const l of wrap(line, colW, 8.6)) {
        text(l, x, yy, { size: 8.6, color: heading === "Från" ? MUTED : INK });
        yy -= 11.5;
      }
    }
    return yy;
  };
  const y1 = block(cx[0], "Från", s.name === brand ? s.name : brand, sellerLines);
  const y2 = block(cx[1], credit ? "Kreditfaktura till" : "Faktureras till", b.name, buyerLines);
  label(credit ? "Kreditfakturauppgifter" : "Fakturauppgifter", cx[2], y);
  let y3 = y - 14;
  for (const [k, v] of meta) {
    text(k, cx[2], y3, { size: 8.6, color: MUTED });
    const lines = wrap(v, colW - 78, 8.6, f.bold);
    lines.forEach((l, i) => text(l, right, y3 - i * 11, { size: 8.6, font: f.bold, align: "right" }));
    y3 -= 11.5 + (lines.length - 1) * 11;
  }
  y = Math.min(y1, y2, y3) - 14;
  if (tpl === "modern" || tpl === "minimal") {
    hair(left, right, y + 4);
    y -= 14;
  }

  // ---------- Fakturarader ----------
  const anyDiscount = doc.lines.some((l) => l.discountBp > 0);
  const pad = tpl === "modern" ? 8 : 0;
  const colSum = right - pad;
  const colVat = colSum - 74;
  const colDisc = colVat - 40;
  const colPrice = (anyDiscount ? colDisc : colVat) - 44;
  const colQty = colPrice - 72;
  const descX = left + pad;
  const descW = colQty - 58 - descX;
  const tableHeader = () => {
    const color = tpl === "modern" ? accentText : tpl === "minimal" ? MUTED : INK;
    const font = tpl === "elegant" ? f.serifBold : f.bold;
    const size = tpl === "minimal" ? 7 : 8.2;
    const up = (t: string) => (tpl === "minimal" ? t.toUpperCase() : t);
    if (tpl === "modern") roundRect(left, y - 8, right - left, 23, 6, tint);
    text(up("Beskrivning"), descX, y, { font, size, color });
    text(up("Antal"), colQty, y, { font, size, color, align: "right" });
    text(up("À-pris"), colPrice, y, { font, size, color, align: "right" });
    if (anyDiscount) text(up("Rabatt"), colDisc, y, { font, size, color, align: "right" });
    text(up("Moms"), colVat, y, { font, size, color, align: "right" });
    text(up(`Belopp (${cur})`), colSum, y, { font, size, color, align: "right" });
    y -= 10;
    if (tpl === "klassisk") page.drawRectangle({ x: left, y, width: right - left, height: 1.2, color: accent });
    else if (tpl !== "modern") hair(left, right, y);
    y -= 15;
  };
  /** Ny sida med en kort rubrik när innehållet inte får plats. */
  const continuePage = (withTable: boolean) => {
    addPage();
    y = H - M;
    text(`${title} ${numberText} – ${brand}`, left, y - 8, { size: 9, color: MUTED });
    text("forts.", right, y - 8, { size: 9, color: MUTED, align: "right" });
    y -= 34;
    if (withTable) tableHeader();
  };
  tableHeader();
  for (const l of doc.lines) {
    const desc = wrap(l.description, descW, 9);
    const period = l.periodStart || l.periodEnd ? `Period ${l.periodStart ?? ""} – ${l.periodEnd ?? ""}` : "";
    const rowH = desc.length * 11.5 + (period ? 10.5 : 0) + 12;
    if (y - rowH < FOOT + 12) continuePage(true);
    text(desc[0], descX, y);
    text(`${qty(l.quantity)} ${l.unit}`, colQty, y, { align: "right" });
    text(money(l.unitPrice), colPrice, y, { align: "right" });
    if (anyDiscount) text(l.discountBp ? `${qty(l.discountBp / 100)} %` : "", colDisc, y, { align: "right", color: MUTED });
    text(`${l.vatRate} %`, colVat, y, { align: "right", color: MUTED });
    text(money(l.net), colSum, y, { align: "right" });
    for (const extra of desc.slice(1)) {
      y -= 11.5;
      text(extra, descX, y);
    }
    if (period) {
      y -= 10.5;
      text(period, descX, y, { size: 7.8, color: MUTED });
    }
    y -= 8;
    hair(left, right, y + 1);
    y -= 13;
  }

  // ---------- Summering ----------
  const t = doc.totals;
  const sumRows: [string, string][] = [];
  if (t.discount) {
    sumRows.push(["Summa före rabatt", money(t.net + t.discount)]);
    sumRows.push(["Rabatt", money(-t.discount)]);
  }
  sumRows.push(["Summa exkl. moms", money(t.net)]);
  for (const r of [...t.byRate].sort((a, b2) => b2.rate - a.rate)) sumRows.push([`Moms ${r.rate} % på ${money(r.net)}`, money(r.vat)]);
  const vatNoteLines = doc.vatNote ? wrap(doc.vatNote, right - left - 236, 8.8, f.bold) : [];
  const sumH = sumRows.length * 14 + 54;
  if (y - Math.max(sumH, vatNoteLines.length * 11.5 + 10) < FOOT + 12) continuePage(false);
  y -= 2;
  const sx = right - 224;
  const sumTop = y;
  for (const [k, v] of sumRows) {
    text(k, sx, y, { color: MUTED, size: 8.8 });
    text(`${v} ${cur}`, right, y, { align: "right", size: 9 });
    y -= 14;
  }
  y -= 10;
  const totalLabel = credit ? "KREDITERAT BELOPP" : "ATT BETALA";
  const totalText = `${money(t.total)} ${cur}`;
  if (tpl === "modern") {
    roundRect(sx - 12, y - 12, right - sx + 12, 32, 8, accent);
    text(totalLabel, sx, y, { font: f.bold, size: 10.5, color: onAccent });
    text(totalText, right - 10, y, { font: f.bold, size: 13, color: onAccent, align: "right" });
    y -= 30;
  } else if (tpl === "elegant") {
    roundRect(sx - 12, y - 16, right - sx + 12, 36, 6, tint);
    text(totalLabel, sx, y, { font: f.serifBold, size: 11.5, color: accentText });
    text(totalText, right - 10, y, { font: f.serifBold, size: 15, color: accentText, align: "right" });
    y -= 32;
  } else if (tpl === "minimal") {
    hair(sx, right, y + 10);
    text(totalLabel, sx, y - 6, { font: f.bold, size: 9.5 });
    text(totalText, right, y - 8, { font: f.bold, size: 17, color: accentText, align: "right" });
    y -= 30;
  } else {
    page.drawLine({ start: { x: sx, y: y + 10 }, end: { x: right, y: y + 10 }, thickness: 1, color: INK });
    text(totalLabel, sx, y - 4, { font: f.bold, size: 10.5 });
    text(totalText, right, y - 4, { font: f.bold, size: 13, align: "right" });
    y -= 24;
  }
  // Hänvisning vid momsfrihet eller omvänd betalningsskyldighet, till vänster om summeringen.
  let ny = sumTop;
  for (const l of vatNoteLines) {
    text(l, left, ny, { font: f.bold, size: 8.8 });
    ny -= 11.5;
  }
  y = Math.min(y, ny - 4);

  if (doc.notes) {
    const lines = wrap(doc.notes, right - left, 8.8);
    if (y - lines.length * 11.5 - 8 < FOOT + 12) continuePage(false);
    y -= 6;
    for (const l of lines) {
      text(l, left, y, { color: MUTED, size: 8.8 });
      y -= 11.5;
    }
  }

  // ---------- Betalning ----------
  if (!credit) {
    const p = doc.payment;
    const swish = p.swishNumber && validSwish(p.swishNumber) ? swishDigits(p.swishNumber) : "";
    const showQr = !!swish && p.swishQr && t.total > 0 && !draft;
    const payLink = safeLink(p.paymentLink);
    const rows: [string, string][] = [["Betalningsmottagare", s.name]];
    if (p.bankgiro) rows.push(["Bankgiro", p.bankgiro]);
    if (p.plusgiro) rows.push(["Plusgiro", p.plusgiro]);
    if (p.bankAccount) {
      if (p.bankName) rows.push(["Bank", p.bankName]);
      rows.push(["Bankkonto", p.bankAccount]);
    }
    if (p.iban) rows.push(["IBAN", p.iban]);
    if (p.bic) rows.push(["BIC", p.bic]);
    if (swish) rows.push(["Swish", swish.replace(/^(\d{3})(\d{3})(\d{2})(\d{2})$/, "$1 $2 $3 $4")]);
    rows.push(["Referens", draft ? "-" : numberText]);
    const boxH = Math.max(rows.length * 13 + 46 + (payLink ? 16 : 0), showQr ? 132 : 0);
    if (y - 14 - boxH < FOOT + 8) continuePage(false);
    y -= 14;
    const top = y;
    const boxed = tpl === "modern" || tpl === "elegant";
    if (boxed) roundRect(left, top - boxH, right - left, boxH, 10, tpl === "modern" ? tint : rgb(0.97, 0.97, 0.975));
    else hair(left, right, top);
    const px = boxed ? left + 16 : left;
    let py = top - 21;
    text("Betalning", px, py, { font: heading, size: tpl === "elegant" ? 12 : 10.5, color: tpl === "modern" ? accentText : INK });
    py -= 17;
    text(`Betala ${money(t.total)} ${cur} senast ${doc.dueDate}. Ange fakturanumret som referens.`, px, py, { size: 8.8 });
    py -= 16;
    for (const [k, v] of rows) {
      text(k, px, py, { color: MUTED, size: 8.4 });
      text(v, px + 96, py, { font: f.bold, size: 8.8 });
      py -= 13;
    }
    if (payLink) {
      const w = text("Betala online »", px, py - 3, { font: f.bold, size: 9.2, color: accentText });
      link(payLink, px, py - 6, w, 14);
    }
    if (showQr) {
      const qrText = swishPayload(swish, t.total, `Faktura ${numberText}`);
      const png = await QRCode.toBuffer(qrText, { type: "png", errorCorrectionLevel: "M", margin: 1, width: 360 });
      const qr = await pdf.embedPng(png);
      const size = 92;
      const qx = right - size - 16;
      const qy = top - 16 - size;
      page.drawImage(qr, { x: qx, y: qy, width: size, height: size });
      text("Skanna med Swish", qx + size / 2, qy - 11, { size: 7.4, color: MUTED, align: "center" });
    }
    y = top - boxH;
  } else if (doc.creditOf) {
    if (y - 30 < FOOT + 8) continuePage(false);
    y -= 18;
    text(`Kreditfakturan avser faktura nr ${doc.creditOf.number ?? "-"} och avräknas mot den. Ingen betalning ska göras.`, left, y, { size: 8.8 });
  }

  // ---------- Sidfot på varje sida ----------
  const legal = [
    s.name,
    s.orgNumber ? `Org.nr ${s.orgNumber}` : "",
    s.vatRegistered && s.vatNumber ? `Momsreg.nr ${s.vatNumber}` : "",
    s.companyType === "ab" && s.seat ? `Styrelsens säte: ${s.seat}` : "",
    s.fSkatt ? "Godkänd för F-skatt" : "",
  ]
    .filter(Boolean)
    .join("  ·  ");
  const terms = credit ? doc.footer.trim() : [doc.payment.lateInterest, doc.payment.reminderFee, doc.footer.trim()].filter(Boolean).join(" ");
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: left, y: FOOT - 10 }, end: { x: right, y: FOOT - 10 }, thickness: 0.5, color: HAIR });
    const ly = wrap(legal, right - left - 60, 7.4);
    let fy = FOOT - 23;
    for (const l of ly.slice(0, 2)) {
      text(l, left, fy, { size: 7.4, color: MUTED, p });
      fy -= 9.5;
    }
    for (const l of wrap(terms, right - left - 60, 7.2).slice(0, 4 - Math.min(2, ly.length))) {
      text(l, left, fy, { size: 7.2, color: MUTED, p });
      fy -= 9.2;
    }
    text(`Sida ${i + 1} av ${pages.length}`, right, FOOT - 23, { size: 7.4, color: MUTED, align: "right", p });
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
