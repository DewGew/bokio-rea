import { apiCompany } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadLogo } from "@/lib/company-logo";
import { invoiceDoc } from "@/lib/invoice-doc";
import { designFromCompany, invoicePdf } from "@/lib/invoice-pdf";

/**
 * Fakturans PDF. Bara inloggade användare med tillgång till företaget kan hämta den (fakturan söks alltid inom det
 * aktiva företaget). Utfärdade fakturor byggs från sin ögonblicksbild, så innehållet ändras inte i efterhand.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiCompany();
  if (!ctx) return new Response("Inte inloggad", { status: 401 });
  const { id } = await params;
  const invoice = await db.invoice.findFirst({
    where: { id: Number(id) || -1, companyId: ctx.companyId },
    include: { customer: true, lines: { orderBy: { id: "asc" } }, creditOf: { select: { number: true, date: true } } },
  });
  if (!invoice) return new Response("Hittades inte", { status: 404 });
  const company = await db.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
  const doc = invoiceDoc(invoice, company);
  const bytes = await invoicePdf(doc, designFromCompany(company), await loadLogo(company));
  const kind = invoice.kind === "credit" ? "Kreditfaktura" : "Faktura";
  const name = `${kind}-${invoice.number ?? "utkast"}-${doc.seller.name}.pdf`.replace(/[^\w.\-åäöÅÄÖ]+/g, "_");
  const download = new URL(req.url).searchParams.has("download");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
