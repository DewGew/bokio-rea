import { apiCompany } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadLogo } from "@/lib/company-logo";
import { designFromCompany, invoicePdf } from "@/lib/invoice-pdf";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiCompany();
  if (!ctx) return new Response("Inte inloggad", { status: 401 });
  const { id } = await params;
  const invoice = await db.invoice.findFirst({
    where: { id: Number(id) || -1, companyId: ctx.companyId },
    include: { customer: true, lines: { orderBy: { id: "asc" } } },
  });
  if (!invoice) return new Response("Hittades inte", { status: 404 });
  const company = await db.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
  const bytes = await invoicePdf(invoice, company, designFromCompany(company), await loadLogo(company));
  const name = `Faktura-${invoice.number ?? "utkast"}-${company.name}.pdf`.replace(/[^\w.\-åäöÅÄÖ]+/g, "_");
  const download = new URL(req.url).searchParams.has("download");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
