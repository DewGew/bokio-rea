import { Prisma, type Company, type Customer, type Invoice, type InvoiceLine, type PrismaClient } from "@prisma/client";
import { db } from "./db";
import { BANK_ACCOUNT, INPUT_VAT, OUTPUT_VAT, PAYABLE_EXPENSES, RECEIVABLES, VAT_SETTLEMENT } from "./bas";
import { vatFromGross } from "./money";
import { calculateTemplateLines } from "./flexible-template-lines";
import { templateLines, type Country } from "./template-lines";
import { FiscalError, ensureFiscalYearFor } from "./fiscal";
import { blocking, invoiceTotals, isVatTreatment, lineNet, salesAccount, validateInvoice, type ValidationInput, type VatTreatment, MIN_INVOICE_NUMBER } from "./invoice-rules";
import { buildInvoiceDoc } from "./invoice-doc";

type Tx = Prisma.TransactionClient | PrismaClient;

export class AccountingError extends Error {}

export type LineInput = { account: number; debit?: number; credit?: number; text?: string };

/** Kör en transaktion; krockar i nummerserier (samtidiga bokningar) blir ett begripligt fel. */
async function tx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AccountingError("Någon annan bokförde samtidigt. Försök igen.");
    }
    throw e;
  }
}

/** Skapar ett balanserat verifikat med nästa lediga nummer för året. */
export async function createVerification(
  t: Tx,
  companyId: number,
  input: {
    date: Date;
    description: string;
    lines: LineInput[];
    series?: string;
    /** Bokslut och ingående balanser rör inte momsen och får bokföras även i en låst momsperiod. */
    ignoreVatLock?: boolean;
  },
) {
  const lines = input.lines
    .map((l) => ({ ...l, debit: l.debit ?? 0, credit: l.credit ?? 0 }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);
  if (lines.length < 2) throw new AccountingError("Ett verifikat måste ha minst två rader.");
  if (lines.some((l) => l.debit < 0 || l.credit < 0)) throw new AccountingError("Belopp får inte vara negativa.");
  const debit = lines.reduce((s, l) => s + l.debit, 0);
  const credit = lines.reduce((s, l) => s + l.credit, 0);
  if (debit !== credit) {
    throw new AccountingError(`Verifikatet balanserar inte (debet ${debit / 100}, kredit ${credit / 100}).`);
  }
  if (!input.description.trim()) throw new AccountingError("Ange en beskrivning.");

  const accounts = await t.account.findMany({ where: { companyId, number: { in: lines.map((l) => l.account) } } });
  const known = new Set(accounts.map((a) => a.number));
  const missing = lines.find((l) => !known.has(l.account));
  if (missing) throw new AccountingError(`Kontot ${missing.account} finns inte i kontoplanen.`);

  if (!input.ignoreVatLock) await assertPeriodOpen(t, companyId, input.date);
  if (input.ignoreVatLock && lines.some((l) => l.account >= 2600 && l.account <= 2699)) {
    throw new AccountingError("Verifikat som påverkar momskontona måste ligga i en öppen momsperiod.");
  }

  // Verifikaten numreras i en obruten serie per räkenskapsår.
  let fiscalYearId: number;
  try {
    fiscalYearId = (await ensureFiscalYearFor(t, companyId, input.date)).id;
  } catch (e) {
    if (e instanceof FiscalError) throw new AccountingError(e.message);
    throw e;
  }
  const series = input.series ?? "V";
  const last = await t.verification.findFirst({ where: { companyId, series, fiscalYearId }, orderBy: { number: "desc" } });

  return t.verification.create({
    data: {
      companyId,
      series,
      fiscalYearId,
      number: (last?.number ?? 0) + 1,
      date: input.date,
      description: input.description.trim(),
      lines: {
        create: lines.map((l) => ({ companyId, accountNumber: l.account, debit: l.debit, credit: l.credit, text: l.text ?? "" })),
      },
    },
  });
}

async function assertPeriodOpen(t: Tx, companyId: number, date: Date) {
  const locked = await t.vatPeriod.findFirst({
    where: { companyId, lockedAt: { not: null }, start: { lte: date }, end: { gte: date } },
  });
  if (locked) throw new AccountingError("Perioden är låst efter momsredovisning. Välj ett senare datum.");
}

/** Makulerar ett verifikat genom att skapa ett omvänt verifikat (bokföringslagen tillåter inte radering). */
export async function reverseVerification(companyId: number, id: number, date?: Date, opts: { ignoreVatLock?: boolean } = {}) {
  return tx(async (t) => {
    const v = await t.verification.findFirst({ where: { id, companyId }, include: { lines: true, reverses: true } });
    if (!v) throw new AccountingError("Verifikatet finns inte.");
    if (v.reversedById) throw new AccountingError("Verifikatet är redan makulerat.");
    if (v.reverses) throw new AccountingError("Ett makuleringsverifikat kan inte makuleras.");
    const rev = await createVerification(t, companyId, {
      date: date ?? v.date,
      description: `Makulering av ${v.series}${v.number}: ${v.description}`,
      lines: v.lines.map((l) => ({ account: l.accountNumber, debit: l.credit, credit: l.debit, text: l.text })),
      series: v.series === "IB" ? "V" : v.series,
      ignoreVatLock: opts.ignoreVatLock,
    });
    await t.verification.update({ where: { id: v.id }, data: { reversedById: rev.id } });
    return rev;
  });
}

/** Bokför med en bokföringsmall: beloppet inkl. moms räknas om till konteringsrader (se template-lines.ts). */
export async function bookWithTemplate(
  companyId: number,
  input: {
    templateId: number;
    date: Date;
    gross: number;
    paymentAccount: number;
    description: string;
    country?: Country;
    comment?: string;
    uploadId?: number;
    uploadIds?: number[];
  },
) {
  return tx(async (t) => {
    const tpl = await t.template.findFirst({ where: { id: input.templateId, companyId } });
    if (!tpl) throw new AccountingError("Mallen finns inte.");
    if (input.gross <= 0) throw new AccountingError("Beloppet måste vara större än noll.");
    const company = await t.company.findUniqueOrThrow({ where: { id: companyId }, select: { vatPeriod: true } });
    const lines = Array.isArray(tpl.lines) && tpl.lines.length
      ? calculateTemplateLines(tpl, input.gross, { payAccount: input.paymentAccount, noVat: company.vatPeriod === "none" })
      : templateLines(tpl, input.gross, { country: input.country, payAccount: input.paymentAccount, noVat: company.vatPeriod === "none" });

    const uploadIds = [...new Set([...(input.uploadIds ?? []), ...(input.uploadId ? [input.uploadId] : [])])];
    if (uploadIds.length) {
      const found = await t.upload.findMany({ where: { id: { in: uploadIds }, companyId, verificationId: null } });
      if (found.length !== uploadIds.length) throw new AccountingError("Något underlag finns inte eller är redan bokfört.");
    }
    const v = await createVerification(t, companyId, { date: input.date, description: input.description || tpl.name, lines });
    if (input.comment) await t.verification.update({ where: { id: v.id }, data: { comment: input.comment.slice(0, 1000) } });
    if (uploadIds.length) {
      await t.upload.updateMany({ where: { id: { in: uploadIds } }, data: { verificationId: v.id, date: input.date, amount: input.gross } });
    }
    await t.template.update({ where: { id: tpl.id }, data: { usageCount: { increment: 1 } } });
    return v;
  });
}

export { invoiceTotals };

/** Vem som gjorde en ändring (för fakturahistoriken). */
export type Actor = { userId?: number | null; via?: string };

export async function logInvoiceEvent(t: Tx, companyId: number, invoiceId: number, type: string, text: string, actor: Actor = {}) {
  await t.invoiceEvent.create({ data: { companyId, invoiceId, type, text, userId: actor.userId ?? null, via: actor.via ?? "" } });
}

const SALES_ACCOUNT_NAMES: Record<number, string> = {
  3231: "Försäljning inom byggsektorn, omvänd betalningsskyldighet",
};

/** Intäkts- och momsrader för en faktura. Intäktskontot beror på momshantering och om raden är vara eller tjänst. */
async function salesLines(t: Tx, companyId: number, lines: Pick<InvoiceLine, "quantity" | "unitPrice" | "vatRate" | "discountBp" | "type">[], treatment: string): Promise<LineInput[]> {
  const vt: VatTreatment = isVatTreatment(treatment) ? treatment : "standard";
  const totals = invoiceTotals(lines);
  const byAccount = new Map<number, number>();
  for (const l of lines) {
    const acc = salesAccount(vt, l);
    byAccount.set(acc, (byAccount.get(acc) ?? 0) + lineNet(l));
  }
  // Konton som saknas i äldre kontoplaner (t.ex. 3231) läggs till.
  const existing = new Set((await t.account.findMany({ where: { companyId, number: { in: [...byAccount.keys()] } }, select: { number: true } })).map((a) => a.number));
  for (const n of byAccount.keys()) {
    if (!existing.has(n)) await t.account.create({ data: { companyId, number: n, name: SALES_ACCOUNT_NAMES[n] ?? `Försäljning ${n}`, vatCode: "0" } });
  }
  const out: LineInput[] = [];
  // Kredit för intäkter (positiva belopp) och debet för kreditfakturor (negativa belopp).
  for (const [acc, amount] of byAccount) out.push(amount >= 0 ? { account: acc, credit: amount } : { account: acc, debit: -amount });
  for (const [rate, v] of totals.byRate) if (v.vat) out.push(v.vat >= 0 ? { account: OUTPUT_VAT[rate], credit: v.vat } : { account: OUTPUT_VAT[rate], debit: -v.vat });
  return out;
}

/** Valideringsunderlag från databasens uppgifter (samma kontroller som formuläret visar). */
export function validationInput(company: Company, customer: Customer | null, inv: Pick<Invoice, "kind" | "date" | "dueDate" | "deliveryDate" | "vatTreatment" | "vatNote" | "simplified">, lines: InvoiceLine[]): ValidationInput {
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);
  return {
    kind: inv.kind === "credit" ? "credit" : "invoice",
    seller: {
      name: company.name,
      orgNumber: company.orgNumber,
      vatNumber: company.vatNumber,
      address: company.address,
      postalCode: company.postalCode,
      city: company.city,
      companyType: company.companyType,
      seat: company.seat,
      vatRegistered: company.vatPeriod !== "none",
      bankgiro: company.bankgiro,
      plusgiro: company.plusgiro,
      bankAccount: company.bankAccount,
      iban: company.iban,
      swishNumber: company.swishNumber,
    },
    buyer: customer && { name: customer.name, orgNumber: customer.orgNumber, vatNumber: customer.vatNumber, address: customer.address, postalCode: customer.postalCode, city: customer.city, country: customer.country },
    invoice: { date: d(inv.date)!, dueDate: d(inv.dueDate)!, deliveryDate: d(inv.deliveryDate), vatTreatment: isVatTreatment(inv.vatTreatment) ? inv.vatTreatment : "standard", vatNote: inv.vatNote, simplified: inv.simplified },
    lines,
  };
}

/** Nästa fakturanummer. Räknaren på företagsraden räknas upp i samma transaktion, så samtidiga utfärdanden köas och får olika nummer. */
async function nextInvoiceNumber(t: Tx, companyId: number) {
  const c = await t.company.update({ where: { id: companyId }, data: { invoiceCounter: { increment: 1 } }, select: { invoiceCounter: true } });
  // Fakturanummer ska ha minst två siffror: en helt ny serie börjar på MIN_INVOICE_NUMBER. En pågående serie fortsätter oavbrutet.
  if (c.invoiceCounter < MIN_INVOICE_NUMBER && (await t.invoice.count({ where: { companyId, number: { not: null } } })) === 0) {
    await t.company.update({ where: { id: companyId }, data: { invoiceCounter: MIN_INVOICE_NUMBER } });
    return MIN_INVOICE_NUMBER;
  }
  return c.invoiceCounter;
}

/**
 * Utfärdar ett fakturautkast: validerar, tilldelar nästa nummer, sparar en oföränderlig ögonblicksbild och bokför
 * kundfordran (fakturametoden). Efter utfärdandet kan fakturan inte ändras, bara krediteras.
 */
export async function sendInvoice(companyId: number, id: number, actor: Actor = {}) {
  return tx(async (t) => {
    const inv = await t.invoice.findFirst({ where: { id, companyId }, include: { lines: { orderBy: { id: "asc" } }, customer: true } });
    if (!inv) throw new AccountingError("Fakturan finns inte.");
    if (inv.status !== "draft") throw new AccountingError("Fakturan är redan utfärdad.");
    const company = await t.company.findUniqueOrThrow({ where: { id: companyId } });
    const errors = blocking(validateInvoice(validationInput(company, inv.customer, inv, inv.lines)));
    if (errors.length) throw new AccountingError(`Fakturan kan inte utfärdas: ${errors.map((e) => e.message).join(" ")}`);
    const totals = invoiceTotals(inv.lines);

    const number = await nextInvoiceNumber(t, companyId);
    const issuedAt = new Date();
    const snapshot = buildInvoiceDoc({ ...inv, number, status: "sent", issuedAt }, company);
    let verificationId: number | null = null;
    // Kontantmetoden: fakturan bokförs först när den betalas.
    if (company.accountingMethod !== "cash") {
      const v = await createVerification(t, companyId, {
        date: inv.date,
        description: `Faktura #${number} till ${inv.customer.name}`,
        lines: [{ account: RECEIVABLES, debit: totals.total }, ...(await salesLines(t, companyId, inv.lines, inv.vatTreatment))],
      });
      verificationId = v.id;
    }
    const updated = await t.invoice.update({
      where: { id },
      data: { number, status: "sent", issuedAt, snapshot: snapshot as unknown as Prisma.InputJsonValue, verificationId },
    });
    await logInvoiceEvent(t, companyId, id, "issued", `Utfärdad som faktura #${number} på ${(totals.total / 100).toFixed(2)} kr`, actor);
    return updated;
  });
}

export async function registerInvoicePayment(companyId: number, id: number, date: Date, account = BANK_ACCOUNT, actor: Actor = {}) {
  return tx(async (t) => {
    const inv = await t.invoice.findFirst({ where: { id, companyId }, include: { lines: true, customer: true } });
    if (!inv) throw new AccountingError("Fakturan finns inte.");
    if (inv.status !== "sent" || inv.kind !== "invoice") throw new AccountingError("Endast utfärdade, obetalda fakturor kan registreras som betalda.");
    const totals = invoiceTotals(inv.lines);
    // Bokförd vid utfärdandet (fakturametoden): betalningen nollar kundfordran.
    // Ej bokförd (kontantmetoden): intäkt och moms bokförs nu, på betaldagen.
    const v = await createVerification(t, companyId, {
      date,
      description: `Faktura #${inv.number} betalad av ${inv.customer.name}`,
      lines: inv.verificationId
        ? [
            { account, debit: totals.total },
            { account: RECEIVABLES, credit: totals.total },
          ]
        : [{ account, debit: totals.total }, ...(await salesLines(t, companyId, inv.lines, inv.vatTreatment))],
    });
    const updated = await t.invoice.update({ where: { id }, data: { status: "paid", paidDate: date, paymentVerificationId: v.id } });
    await logInvoiceEvent(t, companyId, id, "paid", `Betalning registrerad ${date.toISOString().slice(0, 10)} (${v.series}${v.number})`, actor);
    return updated;
  });
}

/**
 * Krediterar en obetald faktura genom att utfärda en kreditfaktura med eget nummer, negativa belopp och hänvisning
 * till originalet. Originalet ändras inte, utom att dess status blir "krediterad".
 */
export async function creditInvoice(companyId: number, id: number, actor: Actor = {}) {
  return tx(async (t) => {
    const inv = await t.invoice.findFirst({ where: { id, companyId }, include: { lines: { orderBy: { id: "asc" } }, customer: true, verification: { include: { lines: true } } } });
    if (!inv) throw new AccountingError("Fakturan finns inte.");
    if (inv.kind !== "invoice" || inv.status !== "sent") throw new AccountingError("Endast utfärdade, obetalda fakturor kan krediteras.");
    const company = await t.company.findUniqueOrThrow({ where: { id: companyId } });
    const today = new Date(new Date().toISOString().slice(0, 10));
    const draft = await t.invoice.create({
      data: {
        companyId,
        customerId: inv.customerId,
        kind: "credit",
        status: "draft",
        creditOfId: inv.id,
        date: today,
        dueDate: today,
        ourReference: inv.ourReference,
        theirReference: inv.theirReference,
        notes: `Kreditering av faktura #${inv.number} daterad ${inv.date.toISOString().slice(0, 10)}.`,
        deliveryDate: inv.deliveryDate,
        vatTreatment: inv.vatTreatment,
        vatNote: inv.vatNote,
        currency: inv.currency,
        lines: {
          create: inv.lines.map((l) => ({
            description: l.description,
            quantity: -l.quantity,
            unit: l.unit,
            unitPrice: l.unitPrice,
            vatRate: l.vatRate,
            type: l.type,
            discountBp: l.discountBp,
            periodStart: l.periodStart,
            periodEnd: l.periodEnd,
          })),
        },
      },
      include: { lines: { orderBy: { id: "asc" } }, customer: true },
    });
    const errors = blocking(validateInvoice(validationInput(company, inv.customer, draft, draft.lines)));
    if (errors.length) throw new AccountingError(`Kreditfakturan kan inte utfärdas: ${errors.map((e) => e.message).join(" ")}`);

    const number = await nextInvoiceNumber(t, companyId);
    const issuedAt = new Date();
    const snapshot = buildInvoiceDoc({ ...draft, number, status: "credit", issuedAt, creditOf: inv }, company);
    let verificationId: number | null = null;
    // Fakturametoden: originalets bokföring vänds i ett eget verifikat för kreditfakturan.
    if (inv.verification) {
      const v = await createVerification(t, companyId, {
        date: today,
        description: `Kreditfaktura #${number} (avser faktura #${inv.number}) till ${inv.customer.name}`,
        lines: inv.verification.lines.map((l) => ({ account: l.accountNumber, debit: l.credit, credit: l.debit, text: l.text })),
      });
      verificationId = v.id;
    }
    const credit = await t.invoice.update({
      where: { id: draft.id },
      data: { number, status: "credit", issuedAt, snapshot: snapshot as unknown as Prisma.InputJsonValue, verificationId },
    });
    await t.invoice.update({ where: { id: inv.id }, data: { status: "credited" } });
    await logInvoiceEvent(t, companyId, credit.id, "issued", `Kreditfaktura #${number} utfärdad, avser faktura #${inv.number}`, actor);
    await logInvoiceEvent(t, companyId, inv.id, "credited", `Krediterad med kreditfaktura #${number}`, actor);
    return credit;
  });
}

export async function bookExpense(companyId: number, id: number) {
  return tx(async (t) => {
    const e = await t.expense.findFirst({ where: { id, companyId } });
    if (!e) throw new AccountingError("Utlägget finns inte.");
    if (e.status !== "pending") throw new AccountingError("Utlägget är redan bokfört.");
    const company = await t.company.findUniqueOrThrow({ where: { id: companyId }, select: { vatPeriod: true } });
    const vat = company.vatPeriod === "none" ? 0 : vatFromGross(e.amount, e.vatRate);
    const v = await createVerification(t, companyId, {
      date: e.date,
      description: `Utlägg ${e.employee}: ${e.description}`,
      lines: [
        { account: e.costAccount, debit: e.amount - vat },
        { account: INPUT_VAT, debit: vat },
        { account: PAYABLE_EXPENSES, credit: e.amount },
      ],
    });
    if (e.uploadId) await t.upload.update({ where: { id: e.uploadId }, data: { verificationId: v.id } });
    return t.expense.update({ where: { id }, data: { status: "booked", verificationId: v.id } });
  });
}

export async function payExpenses(companyId: number, ids: number[], date: Date, account = BANK_ACCOUNT) {
  return tx(async (t) => {
    const list = await t.expense.findMany({ where: { companyId, id: { in: ids }, status: "booked" } });
    if (list.length === 0) throw new AccountingError("Inga bokförda utlägg att betala ut.");
    const total = list.reduce((s, e) => s + e.amount, 0);
    const people = [...new Set(list.map((e) => e.employee))].join(", ");
    const v = await createVerification(t, companyId, {
      date,
      description: `Utbetalning av utlägg till ${people}`,
      lines: [
        { account: PAYABLE_EXPENSES, debit: total },
        { account, credit: total },
      ],
    });
    await t.expense.updateMany({ where: { id: { in: list.map((e) => e.id) } }, data: { status: "paid", paymentVerificationId: v.id } });
    return v;
  });
}

/** Verifikatserie för ingående balanser (räknas som ingående saldo i rapporterna, inte som en händelse under året). */
export const IB_SERIES = "IB";

/** Saldo per konto (debet - kredit) för verifikat inom intervallet. */
export async function balances(
  companyId: number,
  range: { from?: Date; to?: Date; excludeIds?: number[]; series?: { in?: string[]; notIn?: string[] } } = {},
  t: Tx = db,
) {
  const rows = await t.verificationLine.groupBy({
    by: ["accountNumber"],
    where: {
      companyId,
      verification: { date: { gte: range.from, lte: range.to }, series: range.series },
      verificationId: range.excludeIds?.length ? { notIn: range.excludeIds } : undefined,
    },
    _sum: { debit: true, credit: true },
  });
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.accountNumber, (r._sum.debit ?? 0) - (r._sum.credit ?? 0));
  return map;
}

export function sumRange(b: Map<number, number>, from: number, to: number) {
  let s = 0;
  for (const [acc, v] of b) if (acc >= from && acc <= to) s += v;
  return s;
}

export { VAT_SETTLEMENT };
