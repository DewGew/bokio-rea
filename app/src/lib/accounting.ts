import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "./db";
import { BANK_ACCOUNT, INPUT_VAT, OUTPUT_VAT, PAYABLE_EXPENSES, RECEIVABLES, SALES_ACCOUNT, VAT_SETTLEMENT } from "./bas";
import { vatFromGross } from "./money";
import { FiscalError, ensureFiscalYearFor } from "./fiscal";

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

/** Bokför ett uppladdat underlag med hjälp av en bokföringsmall. */
export async function bookWithTemplate(
  companyId: number,
  input: { uploadId?: number; templateId: number; date: Date; gross: number; paymentAccount: number; description: string },
) {
  return tx(async (t) => {
    const found = await t.template.findFirst({ where: { id: input.templateId, companyId } });
    if (!found) throw new AccountingError("Mallen finns inte.");
    // Ett företag som inte är momsregistrerat drar ingen moms: hela beloppet blir kostnad/intäkt.
    const company = await t.company.findUniqueOrThrow({ where: { id: companyId }, select: { vatPeriod: true } });
    const tpl = company.vatPeriod === "none" ? { ...found, vatRate: 0, direction: found.direction === "reverse" ? "purchase" : found.direction } : found;
    if (input.gross <= 0) throw new AccountingError("Beloppet måste vara större än noll.");
    const lines: LineInput[] = [];

    if (tpl.direction === "reverse") {
      // Omvänd skattskyldighet: beloppet saknar svensk moms, moms beräknas på nettot.
      const vat = Math.round((input.gross * tpl.vatRate) / 100);
      lines.push(
        { account: tpl.costAccount, debit: input.gross },
        { account: 2645, debit: vat },
        { account: 2614, credit: vat },
        { account: input.paymentAccount, credit: input.gross },
      );
    } else {
      const vat = vatFromGross(input.gross, tpl.vatRate);
      const net = input.gross - vat;
      if (tpl.direction === "sale") {
        lines.push(
          { account: input.paymentAccount, debit: input.gross },
          { account: tpl.costAccount, credit: net },
          { account: tpl.vatAccount ?? OUTPUT_VAT[tpl.vatRate], credit: vat },
        );
      } else {
        lines.push(
          { account: tpl.costAccount, debit: net },
          { account: tpl.vatAccount ?? INPUT_VAT, debit: vat },
          { account: input.paymentAccount, credit: input.gross },
        );
      }
    }

    if (input.uploadId) {
      const u = await t.upload.findFirst({ where: { id: input.uploadId, companyId } });
      if (!u) throw new AccountingError("Underlaget finns inte.");
      if (u.verificationId) throw new AccountingError("Underlaget är redan bokfört.");
    }
    const v = await createVerification(t, companyId, { date: input.date, description: input.description || tpl.name, lines });
    if (input.uploadId) {
      await t.upload.update({ where: { id: input.uploadId }, data: { verificationId: v.id, date: input.date, amount: input.gross } });
    }
    return v;
  });
}

export function invoiceTotals(lines: { quantity: number; unitPrice: number; vatRate: number }[]) {
  const byRate = new Map<number, { net: number; vat: number }>();
  for (const l of lines) {
    const net = Math.round(l.quantity * l.unitPrice);
    const cur = byRate.get(l.vatRate) ?? { net: 0, vat: 0 };
    cur.net += net;
    byRate.set(l.vatRate, cur);
  }
  for (const [rate, v] of byRate) v.vat = Math.round((v.net * rate) / 100);
  const net = [...byRate.values()].reduce((s, v) => s + v.net, 0);
  const vat = [...byRate.values()].reduce((s, v) => s + v.vat, 0);
  return { byRate, net, vat, total: net + vat };
}

/** Intäkts- och momsrader för en faktura, grupperat per momssats. */
function salesLines(totals: ReturnType<typeof invoiceTotals>): LineInput[] {
  const lines: LineInput[] = [];
  for (const [rate, v] of totals.byRate) {
    lines.push({ account: SALES_ACCOUNT[rate] ?? 3004, credit: v.net });
    if (v.vat) lines.push({ account: OUTPUT_VAT[rate], credit: v.vat });
  }
  return lines;
}

/** Bokför ett fakturautkast: tilldelar fakturanummer och bokför kundfordran. */
export async function sendInvoice(companyId: number, id: number) {
  return tx(async (t) => {
    const inv = await t.invoice.findFirst({ where: { id, companyId }, include: { lines: true, customer: true } });
    if (!inv) throw new AccountingError("Fakturan finns inte.");
    if (inv.status !== "draft") throw new AccountingError("Fakturan är redan skickad.");
    if (inv.lines.length === 0) throw new AccountingError("Fakturan saknar rader.");
    const totals = invoiceTotals(inv.lines);
    if (totals.total <= 0) throw new AccountingError("Fakturans belopp måste vara större än noll.");
    const company = await t.company.findUniqueOrThrow({ where: { id: companyId } });
    if (company.vatPeriod === "none" && totals.vat !== 0) {
      throw new AccountingError("Företaget är inte momsregistrerat och får inte ta ut moms. Sätt momsen till 0 % på alla rader.");
    }

    const last = await t.invoice.findFirst({ where: { companyId, number: { not: null } }, orderBy: { number: "desc" } });
    const number = (last?.number ?? 0) + 1;

    // Kontantmetoden: fakturan bokförs först när den betalas.
    if (company.accountingMethod === "cash") {
      return t.invoice.update({ where: { id }, data: { number, status: "sent" } });
    }
    const v = await createVerification(t, companyId, {
      date: inv.date,
      description: `Faktura #${number} till ${inv.customer.name}`,
      lines: [{ account: RECEIVABLES, debit: totals.total }, ...salesLines(totals)],
    });
    return t.invoice.update({ where: { id }, data: { number, status: "sent", verificationId: v.id } });
  });
}

export async function registerInvoicePayment(companyId: number, id: number, date: Date, account = BANK_ACCOUNT) {
  return tx(async (t) => {
    const inv = await t.invoice.findFirst({ where: { id, companyId }, include: { lines: true, customer: true } });
    if (!inv) throw new AccountingError("Fakturan finns inte.");
    if (inv.status !== "sent") throw new AccountingError("Endast skickade, obetalda fakturor kan registreras som betalda.");
    const totals = invoiceTotals(inv.lines);
    // Bokförd vid utskick (fakturametoden): betalningen nollar kundfordran.
    // Ej bokförd (kontantmetoden): intäkt och moms bokförs nu, på betaldagen.
    const v = await createVerification(t, companyId, {
      date,
      description: `Faktura #${inv.number} betalad av ${inv.customer.name}`,
      lines: inv.verificationId
        ? [
            { account, debit: totals.total },
            { account: RECEIVABLES, credit: totals.total },
          ]
        : [{ account, debit: totals.total }, ...salesLines(totals)],
    });
    return t.invoice.update({ where: { id }, data: { status: "paid", paidDate: date, paymentVerificationId: v.id } });
  });
}

export async function creditInvoice(companyId: number, id: number) {
  const inv = await db.invoice.findFirst({ where: { id, companyId } });
  if (!inv) throw new AccountingError("Fakturan finns inte.");
  if (inv.status !== "sent") throw new AccountingError("Endast obetalda fakturor kan krediteras.");
  // Med kontantmetoden finns inget verifikat att vända förrän fakturan betalats.
  if (inv.verificationId) await reverseVerification(companyId, inv.verificationId);
  return db.invoice.update({ where: { id }, data: { status: "credited" } });
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

export async function payExpenses(companyId: number, ids: number[], date: Date) {
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
        { account: BANK_ACCOUNT, credit: total },
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
