import { apiCompany } from "@/lib/auth";
import { db } from "@/lib/db";
import { invoiceDoc } from "@/lib/invoice-doc";

/**
 * Fakturaregister som CSV (alla utfärdade fakturor och kreditfakturor) för arkivering och revision.
 * Uppgifterna kommer från varje fakturas ögonblicksbild, dvs. som de var när fakturan utfärdades.
 */
export async function GET() {
  const ctx = await apiCompany();
  if (!ctx) return new Response("Inte inloggad", { status: 401 });
  const [company, invoices] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: ctx.companyId } }),
    db.invoice.findMany({
      where: { companyId: ctx.companyId, number: { not: null } },
      include: { customer: true, lines: { orderBy: { id: "asc" } }, creditOf: { select: { number: true, date: true } } },
      orderBy: { number: "asc" },
    }),
  ]);
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const kr = (ore: number) => (ore / 100).toFixed(2).replace(".", ",");
  const rows = [
    ["Nummer", "Typ", "Fakturadatum", "Förfallodatum", "Leveransdatum", "Utfärdad", "Kund", "Kundens org.nr", "Kundens momsreg.nr", "Exkl. moms", "Moms", "Totalt", "Valuta", "Momshantering", "Avser faktura", "Status"],
    ...invoices.map((i) => {
      const d = invoiceDoc(i, company);
      return [
        d.number,
        d.kind === "credit" ? "Kreditfaktura" : "Faktura",
        d.date,
        d.dueDate,
        d.deliveryDate,
        d.issuedAt?.slice(0, 19).replace("T", " "),
        d.buyer.name,
        d.buyer.orgNumber,
        d.buyer.vatNumber,
        kr(d.totals.net),
        kr(d.totals.vat),
        kr(d.totals.total),
        d.currency,
        d.vatTreatment,
        d.creditOf?.number,
        i.status,
      ];
    }),
  ];
  // Semikolon och BOM så att filen öppnas rätt i svenska Excel.
  const csv = "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
  const name = `Fakturor-${company.name}.csv`.replace(/[^\w.\-åäöÅÄÖ]+/g, "_");
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "private, no-store" },
  });
}
