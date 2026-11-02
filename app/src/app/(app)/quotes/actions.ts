"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWriter } from "@/lib/auth";
import { str, withParam } from "@/lib/action";
import { parseDate, parseKr } from "@/lib/money";

type InputLine = { description: string; quantity: number; unit: string; unitPrice: string; vatRate: number; discount: number; type: string };
const parseLines = (raw: string) => {
  let lines: InputLine[];
  try { lines = JSON.parse(raw || "[]"); } catch { throw new Error("Offertens rader kunde inte läsas."); }
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("Lägg till minst en offert-rad.");
  return lines.map((l, i) => {
    const price = parseKr(l.unitPrice);
    if (!l.description?.trim() || !Number.isFinite(Number(l.quantity)) || Number(l.quantity) <= 0 || price == null || price < 0) throw new Error(`Kontrollera offert-rad ${i + 1}.`);
    if (![0, 6, 12, 25].includes(Number(l.vatRate)) || Number(l.discount) < 0 || Number(l.discount) > 100) throw new Error(`Ogiltig moms eller rabatt på rad ${i + 1}.`);
    return { description: l.description.trim().slice(0, 2000), quantity: Number(l.quantity), unit: (l.unit || "st").slice(0, 10), unitPrice: price, vatRate: Number(l.vatRate), discountBp: Math.round(Number(l.discount) * 100), type: l.type === "goods" ? "goods" : "service" };
  });
};

export async function createQuote(fd: FormData) {
  const { companyId, company } = await requireWriter();
  const customerId = Number(str(fd, "customerId"));
  const customer = await db.customer.findFirst({ where: { id: customerId, companyId } });
  if (!customer) redirect(withParam("/quotes/new", "error", "Välj en kund."));
  const date = parseDate(str(fd, "date"));
  const validUntil = parseDate(str(fd, "validUntil"));
  if (!date || !validUntil || validUntil < date) redirect(withParam("/quotes/new", "error", "Ange giltiga datum. Giltig till måste vara efter offertdatum."));
  const quote = await db.$transaction(async (tx) => {
    const c = await tx.company.update({ where: { id: companyId }, data: { quoteCounter: { increment: 1 } }, select: { quoteCounter: true } });
    return tx.quote.create({ data: { companyId, customerId, number: c.quoteCounter, date, validUntil, status: "draft" } });
  });
  redirect(`/quotes/${quote.id}`);
}

export async function saveQuote(fd: FormData) {
  const { companyId } = await requireWriter();
  const id = Number(str(fd, "id"));
  const back = `/quotes/${id}`;
  try {
    const quote = await db.quote.findFirst({ where: { id, companyId } });
    if (!quote || !["draft", "sent"].includes(quote.status)) throw new Error("Offerten kan inte längre ändras.");
    const customerId = Number(str(fd, "customerId"));
    if (!(await db.customer.findFirst({ where: { id: customerId, companyId } }))) throw new Error("Kunden finns inte.");
    const date = parseDate(str(fd, "date"));
    const validUntil = parseDate(str(fd, "validUntil"));
    if (!date || !validUntil || validUntil < date) throw new Error("Ange giltiga datum.");
    const lines = parseLines(str(fd, "lines"));
    await db.$transaction([
      db.quoteLine.deleteMany({ where: { quoteId: id } }),
      db.quote.update({ where: { id }, data: { customerId, date, validUntil, notes: str(fd, "notes").slice(0, 2000), lines: { create: lines } } }),
    ]);
    revalidatePath("/quotes");
    redirect(withParam(back, "ok", "Offerten är sparad."));
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    redirect(withParam(back, "error", e instanceof Error ? e.message : "Kunde inte spara offerten."));
  }
}

export async function setQuoteStatus(fd: FormData) {
  const { companyId } = await requireWriter();
  const id = Number(str(fd, "id"));
  const status = str(fd, "status");
  if (!["sent", "accepted", "rejected"].includes(status)) redirect(withParam(`/quotes/${id}`, "error", "Ogiltig status."));
  const quote = await db.quote.findFirst({ where: { id, companyId } });
  if (!quote || quote.status === "converted" || quote.status === "expired") redirect(withParam(`/quotes/${id}`, "error", "Offerten kan inte ändra status."));
  if (status === "accepted" && quote.validUntil < new Date(new Date().toISOString().slice(0, 10))) redirect(withParam(`/quotes/${id}`, "error", "Offertens giltighetstid har passerat."));
  await db.quote.update({ where: { id }, data: { status } });
  revalidatePath("/quotes");
  redirect(withParam(`/quotes/${id}`, "ok", "Offertens status är uppdaterad."));
}

export async function convertQuote(fd: FormData) {
  const { companyId } = await requireWriter();
  const id = Number(str(fd, "id"));
  const quote = await db.quote.findFirst({ where: { id, companyId }, include: { lines: { orderBy: { id: "asc" } } } });
  if (!quote || quote.status !== "accepted" || quote.invoiceId || quote.validUntil < new Date(new Date().toISOString().slice(0, 10))) redirect(withParam(`/quotes/${id}`, "error", "Endast en giltig och accepterad offert kan omvandlas."));
  const invoice = await db.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        companyId, customerId: quote.customerId, date: new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z"),
        dueDate: new Date(Date.now() + 30 * 86400000), notes: quote.notes,
        theirReference: `Offert ${quote.number ?? quote.id}`,
        lines: { create: quote.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, vatRate: l.vatRate, discountBp: l.discountBp, type: l.type })) },
      },
    });
    await tx.quote.update({ where: { id }, data: { status: "converted", invoiceId: created.id } });
    return created;
  });
  revalidatePath("/quotes");
  redirect(withParam(`/invoices/${invoice.id}`, "ok", `Offert ${quote.number ?? ""} har omvandlats till ett fakturautkast. Granska och utfärda fakturan när den är klar.`));
}
