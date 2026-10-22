// Fakturans innehåll som ett fristående dokument. Byggs från aktuella uppgifter för utkast och sparas som en
// oföränderlig ögonblicksbild (Invoice.snapshot) när fakturan utfärdas, så att en utfärdad faktura alltid visar de
// företags-, kund- och betalningsuppgifter som gällde då – även om uppgifterna ändras senare.
import type { Company, Customer, Invoice, InvoiceLine } from "@prisma/client";
import { invoiceTotals, isOrganisationNumber, isVatTreatment, lateInterestText, lineNet, reminderFeeText, type VatTreatment } from "./invoice-rules";

export type DocLine = {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  vatRate: number;
  discountBp: number;
  type: string;
  periodStart: string | null;
  periodEnd: string | null;
  net: number;
};

export type InvoiceDoc = {
  version: 1;
  kind: "invoice" | "credit";
  number: number | null;
  status: string;
  date: string;
  dueDate: string;
  deliveryDate: string | null;
  issuedAt: string | null;
  currency: string;
  ourReference: string;
  theirReference: string;
  notes: string;
  vatTreatment: VatTreatment;
  vatNote: string;
  simplified: boolean;
  creditOf: { number: number | null; date: string } | null;
  seller: {
    name: string;
    tradeName: string;
    orgNumber: string;
    vatNumber: string;
    address: string;
    postalCode: string;
    city: string;
    seat: string;
    companyType: string;
    phone: string;
    email: string;
    website: string;
    fSkatt: boolean;
    vatRegistered: boolean;
  };
  buyer: {
    name: string;
    orgNumber: string; // bara organisationsnummer – personnummer för privatpersoner skrivs inte ut
    vatNumber: string;
    address: string;
    postalCode: string;
    city: string;
    country: string;
    reference: string;
    email: string;
  };
  payment: {
    bankgiro: string;
    plusgiro: string;
    iban: string;
    bic: string;
    swishNumber: string;
    swishQr: boolean;
    paymentLink: string;
    termsDays: number;
    lateInterest: string;
    reminderFee: string;
  };
  lines: DocLine[];
  totals: { net: number; vat: number; total: number; discount: number; byRate: { rate: number; net: number; vat: number }[] };
  footer: string;
};

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

type Full = Invoice & { customer: Customer; lines: InvoiceLine[]; creditOf?: Pick<Invoice, "number" | "date"> | null };

/** Bygger dokumentet från aktuella uppgifter (för utkast, och vid utfärdandet för ögonblicksbilden). */
export function buildInvoiceDoc(invoice: Full, company: Company): InvoiceDoc {
  const c = invoice.customer;
  const lines = [...invoice.lines].sort((a, b) => a.id - b.id);
  const t = invoiceTotals(lines);
  return {
    version: 1,
    kind: invoice.kind === "credit" ? "credit" : "invoice",
    number: invoice.number,
    status: invoice.status,
    date: day(invoice.date)!,
    dueDate: day(invoice.dueDate)!,
    deliveryDate: day(invoice.deliveryDate),
    issuedAt: invoice.issuedAt ? invoice.issuedAt.toISOString() : null,
    currency: invoice.currency || "SEK",
    ourReference: invoice.ourReference,
    theirReference: invoice.theirReference,
    notes: invoice.notes,
    vatTreatment: isVatTreatment(invoice.vatTreatment) ? invoice.vatTreatment : "standard",
    vatNote: invoice.vatNote,
    simplified: invoice.simplified,
    creditOf: invoice.creditOf ? { number: invoice.creditOf.number, date: day(invoice.creditOf.date)! } : null,
    seller: {
      name: company.name,
      tradeName: company.tradeName,
      orgNumber: company.orgNumber,
      vatNumber: company.vatPeriod === "none" ? "" : company.vatNumber,
      address: company.address,
      postalCode: company.postalCode,
      city: company.city,
      seat: company.seat,
      companyType: company.companyType,
      phone: company.phone,
      email: company.email,
      website: company.website,
      fSkatt: company.fSkatt,
      vatRegistered: company.vatPeriod !== "none",
    },
    buyer: {
      name: c.name,
      orgNumber: isOrganisationNumber(c.orgNumber) ? c.orgNumber : "",
      vatNumber: c.vatNumber,
      address: c.address,
      postalCode: c.postalCode,
      city: c.city,
      country: (c.country || "SE").toUpperCase(),
      reference: c.reference,
      email: c.email,
    },
    payment: {
      bankgiro: company.bankgiro,
      plusgiro: company.plusgiro,
      iban: company.iban,
      bic: company.bic,
      swishNumber: company.swishNumber,
      swishQr: company.swishQr,
      paymentLink: company.paymentLink,
      termsDays: Math.max(0, Math.round((invoice.dueDate.getTime() - invoice.date.getTime()) / 86_400_000)),
      lateInterest: lateInterestText(company.lateInterestRate),
      reminderFee: reminderFeeText(company.reminderFee),
    },
    lines: lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      discountBp: l.discountBp,
      type: l.type,
      periodStart: day(l.periodStart),
      periodEnd: day(l.periodEnd),
      net: lineNet(l),
    })),
    totals: { net: t.net, vat: t.vat, total: t.total, discount: t.discount, byRate: [...t.byRate.entries()].map(([rate, v]) => ({ rate, net: v.net, vat: v.vat })) },
    footer: company.invoiceFooter,
  };
}

/**
 * Dokumentet för en faktura: den sparade ögonblicksbilden om fakturan är utfärdad, annars aktuella uppgifter.
 * Status (betald, krediterad) är inte en del av fakturans innehåll och tas alltid från databasen.
 */
export function invoiceDoc(invoice: Full, company: Company): InvoiceDoc {
  const snap = invoice.snapshot as InvoiceDoc | null;
  if (snap && snap.version === 1) return { ...snap, status: invoice.status };
  return buildInvoiceDoc(invoice, company);
}

export const COUNTRIES: Record<string, string> = {
  SE: "Sverige",
  NO: "Norge",
  DK: "Danmark",
  FI: "Finland",
  IS: "Island",
  DE: "Tyskland",
  NL: "Nederländerna",
  BE: "Belgien",
  FR: "Frankrike",
  ES: "Spanien",
  PT: "Portugal",
  IT: "Italien",
  AT: "Österrike",
  IE: "Irland",
  PL: "Polen",
  EE: "Estland",
  LV: "Lettland",
  LT: "Litauen",
  CZ: "Tjeckien",
  SK: "Slovakien",
  HU: "Ungern",
  SI: "Slovenien",
  HR: "Kroatien",
  RO: "Rumänien",
  BG: "Bulgarien",
  GR: "Grekland",
  CY: "Cypern",
  MT: "Malta",
  LU: "Luxemburg",
  GB: "Storbritannien",
  CH: "Schweiz",
  US: "USA",
};

export const countryName = (code: string) => COUNTRIES[code.toUpperCase()] ?? code.toUpperCase();
