import "server-only";
import { db } from "./db";
import { dateStr } from "./money";
import { fyLabel } from "./fiscal";
import { readStored } from "./storage";
import { loadLogo } from "./company-logo";
import { invoiceDoc } from "./invoice-doc";
import { designFromCompany, invoicePdf } from "./invoice-pdf";
import type { ZipEntry } from "./zip-stream";

const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/\s+/g, " ").trim() || "fil";
const cell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const kr = (ore: number) => (ore / 100).toFixed(2).replace(".", ",");

export async function underlagCounts(companyId: number, fy: { start: Date; end: Date; id: number }) {
  const [uploads, invoices] = await Promise.all([
    db.upload.count({ where: { companyId, verification: { fiscalYearId: fy.id } } }),
    db.invoice.count({ where: { companyId, number: { not: null }, date: { gte: fy.start, lte: fy.end } } }),
  ]);
  return { uploads, invoices, total: uploads + invoices + 1 };
}

/** Underlag och fakturakopior för ett räkenskapsår, som ZIP-poster. Indexfilen kommer sist. */
export async function* underlagEntries(companyId: number, fy: { id: number; start: Date; end: Date }): AsyncGenerator<ZipEntry> {
  const enc = new TextEncoder();
  const index: (string | number)[][] = [
    ["Typ", "Verifikat", "Datum", "Beskrivning", "Belopp", "Filnamn i arkivet", "Originalfilnamn", "Status"],
  ];

  const uploads = await db.upload.findMany({
    where: { companyId, verification: { fiscalYearId: fy.id } },
    include: { verification: true },
    orderBy: [{ verification: { date: "asc" } }, { id: "asc" }],
  });
  const used = new Set<string>();
  for (const u of uploads) {
    const v = u.verification!;
    const ver = `${v.series}${v.number}`;
    let path = `Underlag/${ver}/${safe(u.fileName)}`;
    if (used.has(path)) path = `Underlag/${ver}/${u.id}-${safe(u.fileName)}`;
    used.add(path);
    const data = await readStored({ storedName: u.storedName, blobUrl: u.blobUrl }).catch(() => null);
    index.push(["Underlag", ver, dateStr(v.date), v.description, u.amount != null ? kr(u.amount) : "", data ? path : "", u.fileName, data ? "ok" : "SAKNAS I LAGRINGEN"]);
    if (data) yield { name: path, data, date: u.createdAt };
  }

  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  const invoices = await db.invoice.findMany({
    where: { companyId, number: { not: null }, date: { gte: fy.start, lte: fy.end } },
    include: { customer: true, lines: { orderBy: { id: "asc" } }, creditOf: { select: { number: true, date: true } } },
    orderBy: { number: "asc" },
  });
  const logo = invoices.length ? await loadLogo(company) : null;
  for (const inv of invoices) {
    const doc = invoiceDoc(inv, company);
    const kind = inv.kind === "credit" ? "Kreditfaktura" : "Faktura";
    const path = `Fakturor/${kind}-${inv.number}.pdf`;
    let status = "ok";
    try {
      const bytes = await invoicePdf(doc, designFromCompany(company), logo);
      yield { name: path, data: new Uint8Array(bytes), date: inv.issuedAt ?? inv.date };
    } catch {
      status = "KUNDE INTE SKAPAS";
    }
    index.push([kind, "", dateStr(inv.date), doc.buyer.name, kr(doc.totals.total), status === "ok" ? path : "", "", status]);
  }

  const csv = "\ufeff" + index.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
  yield { name: `Index-${safe(fyLabel(fy))}.csv`, data: enc.encode(csv) };
}
