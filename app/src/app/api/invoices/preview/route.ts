import type { Customer, Invoice, InvoiceLine } from "@prisma/client";
import { apiCompany } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadLogo } from "@/lib/company-logo";
import { isTemplate, validHex } from "@/lib/invoice-design";
import { designFromCompany, invoicePdf } from "@/lib/invoice-pdf";

/**
 * Förhandsvisning av fakturadesignen. Designen kan skrivas över via query-parametrar så att
 * designverktyget kan visa ändringar innan de sparas. Använder senaste fakturan, annars exempeldata.
 */
export async function GET(req: Request) {
  const ctx = await apiCompany();
  if (!ctx) return new Response("Inte inloggad", { status: 401 });
  const q = new URL(req.url).searchParams;
  const company = await db.company.findUniqueOrThrow({ where: { id: ctx.companyId } });

  const template = q.get("template") ?? "";
  const color = q.get("color") ?? "";
  const design = designFromCompany(company, {
    ...(isTemplate(template) ? { template } : {}),
    ...(validHex(color) ? { color } : {}),
    ...(q.has("footer") ? { footer: q.get("footer")!.slice(0, 300) } : {}),
    ...(q.has("swishNumber") ? { swishNumber: q.get("swishNumber")! } : {}),
    ...(q.has("swishQr") ? { swishQr: q.get("swishQr") === "1" } : {}),
    ...(q.has("paymentLink") ? { paymentLink: q.get("paymentLink")! } : {}),
  });
  // Betalningsuppgifter som ännu inte sparats visas också i förhandsvisningen.
  const preview = {
    ...company,
    bankgiro: q.get("bankgiro") ?? company.bankgiro,
    plusgiro: q.get("plusgiro") ?? company.plusgiro,
    iban: q.get("iban") ?? company.iban,
    bic: q.get("bic") ?? company.bic,
    phone: q.get("phone") ?? company.phone,
    website: q.get("website") ?? company.website,
  };

  const latest = await db.invoice.findFirst({
    where: { companyId: ctx.companyId, number: { not: null } },
    orderBy: { id: "desc" },
    include: { customer: true, lines: { orderBy: { id: "asc" } } },
  });
  const invoice = latest ?? sampleInvoice(ctx.companyId, company.invoiceDays);

  const bytes = await invoicePdf(invoice, preview, design, await loadLogo(company));
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store" },
  });
}

function sampleInvoice(companyId: number, days: number): Invoice & { customer: Customer; lines: InvoiceLine[] } {
  const date = new Date(new Date().toISOString().slice(0, 10));
  const base = { invoiceId: 0, unit: "tim", type: "service" };
  return {
    id: 0,
    companyId,
    number: 1001,
    customerId: 0,
    date,
    dueDate: new Date(date.getTime() + days * 86400000),
    status: "sent",
    ourReference: "Anna Exempel",
    theirReference: "Erik Kund",
    notes: "Tack för förtroendet!",
    paidDate: null,
    createdAt: date,
    verificationId: null,
    paymentVerificationId: null,
    customer: {
      id: 0,
      companyId,
      name: "Exempelkunden AB",
      orgNumber: "556677-8899",
      email: "",
      address: "Storgatan 1",
      postalCode: "111 22",
      city: "Stockholm",
      reference: "",
    },
    lines: [
      { ...base, id: 1, description: "Konsulttjänster, oktober", quantity: 24, unitPrice: 95000, vatRate: 25 },
      { ...base, id: 2, description: "Workshop och dokumentation", quantity: 1, unit: "st", unitPrice: 450000, vatRate: 25 },
    ],
  };
}
