"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWriter } from "@/lib/auth";
import { AccountingError, creditInvoice, logInvoiceEvent, registerInvoicePayment, sendInvoice } from "@/lib/accounting";
import { attempt, str, withParam } from "@/lib/action";
import { parseDate, parseKr } from "@/lib/money";
import { isVatTreatment, suggestedVatNote } from "@/lib/invoice-rules";

const EU = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SI", "SK"];

export async function createDraft(fd: FormData) {
  const { companyId, company, user } = await requireWriter();
  const customerId = Number(str(fd, "customerId"));
  const customer = customerId ? await db.customer.findFirst({ where: { id: customerId, companyId } }) : null;
  if (!customer) redirect(withParam("/invoices/new", "error", "Välj en kund."));
  const date = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  // Förslag på momshantering utifrån kundens land (kan ändras i utkastet).
  const country = (customer.country || "SE").toUpperCase();
  const treatment = company.vatPeriod === "none" || country === "SE" ? "standard" : EU.includes(country) ? "eu" : "export";
  const inv = await db.invoice.create({
    data: {
      companyId,
      customerId: customer.id,
      date,
      dueDate: new Date(date.getTime() + company.invoiceDays * 86400000),
      theirReference: customer.reference,
      vatTreatment: treatment,
      vatNote: suggestedVatNote(treatment),
    },
  });
  await logInvoiceEvent(db, companyId, inv.id, "created", "Utkast skapat", { userId: user.id });
  redirect(`/invoices/${inv.id}`);
}

type LineIn = { description: string; quantity: string; unit: string; unitPrice: string; vatRate: string; discount?: string; type?: string; periodStart?: string; periodEnd?: string };

const num = (s: string | undefined) => Number(String(s ?? "").replace(/\s/g, "").replace(",", "."));

async function persistDraft(fd: FormData, send: boolean) {
  const { companyId, user } = await requireWriter();
  const id = Number(str(fd, "id"));
  const back = `/invoices/${id}`;
  await attempt(async () => {
    const inv = await db.invoice.findFirst({ where: { id, companyId } });
    if (!inv || inv.status !== "draft") throw new AccountingError("Endast utkast kan ändras. En utfärdad faktura rättas med en kreditfaktura.");
    const date = parseDate(str(fd, "date"));
    const dueDate = parseDate(str(fd, "dueDate"));
    if (!date || !dueDate) throw new AccountingError("Ange fakturadatum och förfallodatum.");
    if (dueDate < date) throw new AccountingError("Förfallodatum kan inte vara före fakturadatum.");
    const deliveryRaw = str(fd, "deliveryDate");
    const deliveryDate = deliveryRaw ? parseDate(deliveryRaw) : null;
    if (deliveryRaw && !deliveryDate) throw new AccountingError("Leveransdatum har fel format.");
    const customerId = Number(str(fd, "customerId")) || inv.customerId;
    if (!(await db.customer.findFirst({ where: { id: customerId, companyId } }))) throw new AccountingError("Kunden finns inte.");
    const treatment = str(fd, "vatTreatment");
    const raw = JSON.parse(str(fd, "lines") || "[]") as LineIn[];
    const lines = raw
      .filter((l) => l.description.trim() || l.unitPrice.trim())
      .map((l, i) => {
        const quantity = num(l.quantity);
        const unitPrice = parseKr(l.unitPrice);
        const discount = l.discount?.trim() ? num(l.discount) : 0;
        if (!l.description.trim()) throw new AccountingError(`Rad ${i + 1} saknar beskrivning.`);
        if (!Number.isFinite(quantity) || quantity === 0) throw new AccountingError(`Rad ${i + 1} har ogiltigt antal.`);
        if (unitPrice == null) throw new AccountingError(`Rad ${i + 1} har ogiltigt pris.`);
        if (!Number.isFinite(discount) || discount < 0 || discount > 100) throw new AccountingError(`Rad ${i + 1}: rabatten måste vara 0–100 %.`);
        const periodStart = l.periodStart ? parseDate(l.periodStart) : null;
        const periodEnd = l.periodEnd ? parseDate(l.periodEnd) : null;
        if ((l.periodStart && !periodStart) || (l.periodEnd && !periodEnd)) throw new AccountingError(`Rad ${i + 1}: perioden har fel datumformat.`);
        return {
          description: l.description.trim().slice(0, 2000),
          quantity,
          unit: (l.unit || "st").slice(0, 10),
          unitPrice,
          vatRate: Number(l.vatRate) || 0,
          discountBp: Math.round(discount * 100),
          type: l.type === "goods" ? "goods" : "service",
          periodStart,
          periodEnd,
        };
      });
    await db.$transaction([
      db.invoiceLine.deleteMany({ where: { invoiceId: id } }),
      db.invoice.update({
        where: { id },
        data: {
          customerId,
          date,
          dueDate,
          deliveryDate,
          vatTreatment: isVatTreatment(treatment) ? treatment : "standard",
          vatNote: str(fd, "vatNote").slice(0, 500),
          simplified: fd.get("simplified") === "on",
          ourReference: str(fd, "ourReference"),
          theirReference: str(fd, "theirReference"),
          notes: str(fd, "notes").slice(0, 2000),
          lines: { create: lines },
        },
      }),
    ]);
  }, back);
  if (send) {
    const sent = await attempt(() => sendInvoice(companyId, id, { userId: user.id }), back);
    redirect(withParam(back, "ok", `Faktura #${sent.number} är utfärdad${sent.verificationId ? " och bokförd" : ""}. Ladda ner PDF:en och skicka den till kunden.`));
  }
  redirect(withParam(back, "ok", "Utkastet är sparat."));
}

export async function saveDraft(fd: FormData) {
  await persistDraft(fd, false);
}

export async function saveAndSend(fd: FormData) {
  await persistDraft(fd, true);
}

export async function deleteDraft(fd: FormData) {
  const { companyId } = await requireWriter();
  const id = Number(str(fd, "id"));
  await db.invoice.deleteMany({ where: { id, companyId, status: "draft" } });
  revalidatePath("/", "layout");
  redirect(withParam("/invoices", "ok", "Utkastet togs bort."));
}

export async function markPaid(fd: FormData) {
  const { companyId, user } = await requireWriter();
  const id = Number(str(fd, "id"));
  const back = `/invoices/${id}`;
  await attempt(async () => {
    const date = parseDate(str(fd, "paidDate"));
    if (!date) throw new AccountingError("Ange betaldatum.");
    const account = str(fd, "account") === "1910" ? 1910 : 1930;
    return registerInvoicePayment(companyId, id, date, account, { userId: user.id });
  }, back);
  redirect(withParam(back, "ok", "Betalningen är registrerad och bokförd."));
}

export async function credit(fd: FormData) {
  const { companyId, user } = await requireWriter();
  const id = Number(str(fd, "id"));
  const back = `/invoices/${id}`;
  const note = await attempt(() => creditInvoice(companyId, id, { userId: user.id }), back);
  redirect(withParam(`/invoices/${note.id}`, "ok", `Kreditfaktura #${note.number} är utfärdad. Originalfakturan är markerad som krediterad.`));
}
