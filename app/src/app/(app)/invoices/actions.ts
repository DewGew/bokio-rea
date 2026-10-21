"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWriter } from "@/lib/auth";
import { AccountingError, creditInvoice, registerInvoicePayment, sendInvoice } from "@/lib/accounting";
import { attempt, str, withParam } from "@/lib/action";
import { parseDate, parseKr } from "@/lib/money";

export async function createDraft(fd: FormData) {
  const { companyId, company } = await requireWriter();
  const customerId = Number(str(fd, "customerId"));
  const customer = customerId ? await db.customer.findFirst({ where: { id: customerId, companyId } }) : null;
  if (!customer) redirect(withParam("/invoices/new", "error", "Välj en kund."));
  const date = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const inv = await db.invoice.create({
    data: {
      companyId,
      customerId: customer.id,
      date,
      dueDate: new Date(date.getTime() + company.invoiceDays * 86400000),
    },
  });
  redirect(`/invoices/${inv.id}`);
}

type LineIn = { description: string; quantity: string; unit: string; unitPrice: string; vatRate: string };

async function persistDraft(fd: FormData, send: boolean) {
  const { companyId } = await requireWriter();
  const id = Number(str(fd, "id"));
  const back = `/invoices/${id}`;
  await attempt(async () => {
    const inv = await db.invoice.findFirst({ where: { id, companyId } });
    if (!inv || inv.status !== "draft") throw new AccountingError("Endast utkast kan ändras.");
    const date = parseDate(str(fd, "date"));
    const dueDate = parseDate(str(fd, "dueDate"));
    if (!date || !dueDate) throw new AccountingError("Ange fakturadatum och förfallodatum.");
    if (dueDate < date) throw new AccountingError("Förfallodatum kan inte vara före fakturadatum.");
    const customerId = Number(str(fd, "customerId")) || inv.customerId;
    if (!(await db.customer.findFirst({ where: { id: customerId, companyId } }))) throw new AccountingError("Kunden finns inte.");
    const raw = JSON.parse(str(fd, "lines") || "[]") as LineIn[];
    const lines = raw
      .filter((l) => l.description.trim() || l.unitPrice.trim())
      .map((l, i) => {
        const quantity = Number(String(l.quantity).replace(",", "."));
        const unitPrice = parseKr(l.unitPrice);
        if (!l.description.trim()) throw new AccountingError(`Rad ${i + 1} saknar beskrivning.`);
        if (!Number.isFinite(quantity) || quantity === 0) throw new AccountingError(`Rad ${i + 1} har ogiltigt antal.`);
        if (unitPrice == null) throw new AccountingError(`Rad ${i + 1} har ogiltigt pris.`);
        return { description: l.description.trim(), quantity, unit: l.unit || "st", unitPrice, vatRate: Number(l.vatRate) || 0 };
      });
    await db.$transaction([
      db.invoiceLine.deleteMany({ where: { invoiceId: id } }),
      db.invoice.update({
        where: { id },
        data: {
          customerId,
          date,
          dueDate,
          ourReference: str(fd, "ourReference"),
          theirReference: str(fd, "theirReference"),
          notes: str(fd, "notes"),
          lines: { create: lines },
        },
      }),
    ]);
  }, back);
  if (send) {
    const sent = await attempt(() => sendInvoice(companyId, id), back);
    redirect(withParam(back, "ok", `Faktura #${sent.number} är bokförd. Ladda ner PDF:en och skicka den till kunden.`));
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
  const { companyId } = await requireWriter();
  const id = Number(str(fd, "id"));
  const back = `/invoices/${id}`;
  await attempt(async () => {
    const date = parseDate(str(fd, "paidDate"));
    if (!date) throw new AccountingError("Ange betaldatum.");
    const account = str(fd, "account") === "1910" ? 1910 : 1930;
    return registerInvoicePayment(companyId, id, date, account);
  }, back);
  redirect(withParam(back, "ok", "Betalningen är registrerad och bokförd."));
}

export async function credit(fd: FormData) {
  const { companyId } = await requireWriter();
  const id = Number(str(fd, "id"));
  const back = `/invoices/${id}`;
  await attempt(() => creditInvoice(companyId, id), back);
  redirect(withParam(back, "ok", "Fakturan är krediterad."));
}
