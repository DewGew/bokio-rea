import { apiCompany } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadLogo } from "@/lib/company-logo";
import { designFromCompany, invoicePdf } from "@/lib/invoice-pdf";
import { invoiceTotals, isOrganisationNumber, lineNet, lateInterestText, reminderFeeText } from "@/lib/invoice-rules";
import type { InvoiceDoc } from "@/lib/invoice-doc";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiCompany();
  if (!ctx) return new Response("Inte inloggad", { status: 401 });
  const { id } = await params;
  const quote = await db.quote.findFirst({ where: { id: Number(id) || -1, companyId: ctx.companyId }, include: { customer: true, lines: { orderBy: { id: "asc" } } } });
  if (!quote) return new Response("Hittades inte", { status: 404 });
  const company = await db.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
  const c = quote.customer;
  const totals = invoiceTotals(quote.lines);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const doc: InvoiceDoc = {
    version: 1, kind: "quote", number: quote.number, status: quote.status, date: day(quote.date), dueDate: day(quote.validUntil),
    deliveryDate: null, issuedAt: null, currency: "SEK", ourReference: "", theirReference: c.reference, notes: quote.notes,
    vatTreatment: "standard", vatNote: "", simplified: false, creditOf: null,
    seller: {
      name: company.name, tradeName: company.tradeName, orgNumber: company.orgNumber, vatNumber: company.vatPeriod === "none" ? "" : company.vatNumber,
      address: company.address, postalCode: company.postalCode, city: company.city, seat: company.seat, companyType: company.companyType,
      phone: company.phone, email: company.email, website: company.website, fSkatt: company.fSkatt, vatRegistered: company.vatPeriod !== "none",
    },
    buyer: {
      name: c.name, orgNumber: isOrganisationNumber(c.orgNumber) ? c.orgNumber : "", vatNumber: c.vatNumber, address: c.address,
      postalCode: c.postalCode, city: c.city, country: (c.country || "SE").toUpperCase(), reference: c.reference, email: c.email,
    },
    payment: {
      bankgiro: "", plusgiro: "", bankName: "", bankAccount: "", iban: "", bic: "", swishNumber: "", swishQr: false, paymentLink: "",
      termsDays: 0, lateInterest: lateInterestText(company.lateInterestRate), reminderFee: reminderFeeText(company.reminderFee),
    },
    lines: quote.lines.map(l => ({ description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, vatRate: l.vatRate, discountBp: l.discountBp, type: l.type, periodStart: null, periodEnd: null, net: lineNet(l) })),
    totals: { net: totals.net, vat: totals.vat, total: totals.total, discount: totals.discount, byRate: [...totals.byRate.entries()].map(([rate, v]) => ({ rate, net: v.net, vat: v.vat })) },
    footer: company.invoiceFooter,
  };
  const bytes = await invoicePdf(doc, designFromCompany(company), await loadLogo(company));
  const name = `Offert-${quote.number ?? "Utkast"}-${company.name}.pdf`.replace(/[^\w.\-åäöÅÄÖ]+/g, "_");
  const download = new URL(req.url).searchParams.has("download");
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "private, no-store" } });
}
