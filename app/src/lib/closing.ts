import type { Company, FiscalYear } from "@prisma/client";
import { db } from "./db";
import { AccountingError, IB_SERIES, balances, createVerification, reverseVerification, sumRange, type LineInput } from "./accounting";
import { addMonths, ensureFiscalYearFor, fiscalYears, fyLabel } from "./fiscal";
import { vatPeriods } from "./vat";

/** Bolagsskatt för räkenskapsår som börjar 2021 eller senare. */
export const CORPORATE_TAX_RATE = 0.206;
/** Konton som normalt inte är avdragsgilla och läggs tillbaka i skatteunderlaget. */
const NON_DEDUCTIBLE = [6072, 6992, 8423];

const hasCorporateTax = (c: Company) => c.companyType === "ab" || c.companyType === "ek";
/** Konto där årets resultat samlas: 2099 för AB/ekonomisk förening, 2019 för enskild firma/handelsbolag. */
const resultAccount = (c: Company) => (hasCorporateTax(c) ? 2099 : 2019);

export type ClosingCheck = { ok: boolean; blocking: boolean; text: string; href?: string };

/** Underlag för bokslutet: kontroller, resultat, skatteförslag och verifikaten som kommer att bokföras. */
export async function closingPreview(companyId: number, fyId: number, taxOverride?: number) {
  const [company, years] = await Promise.all([db.company.findUniqueOrThrow({ where: { id: companyId } }), fiscalYears(companyId)]);
  const i = years.findIndex((y) => y.id === fyId);
  const fy = years[i];
  if (!fy) throw new AccountingError("Räkenskapsåret finns inte.");
  const prev = years[i - 1];
  const today = new Date(new Date().toISOString().slice(0, 10));

  const [bal, unbookedUploads, pendingExpenses, unpaidCash, periods] = await Promise.all([
    balances(companyId, { from: fy.start, to: fy.end }),
    db.upload.count({ where: { companyId, verificationId: null, expense: null } }),
    db.expense.count({ where: { companyId, status: "pending", date: { lte: fy.end } } }),
    company.accountingMethod === "cash" ? db.invoice.count({ where: { companyId, status: "sent", date: { lte: fy.end } } }) : Promise.resolve(0),
    vatPeriods(companyId),
  ]);
  const openVat = company.vatPeriod === "none" ? [] : periods.filter((p) => !p.lockedAt && p.start <= fy.end && p.end >= fy.start);

  const checks: ClosingCheck[] = [
    { ok: fy.end < today, blocking: true, text: fy.end < today ? "Räkenskapsåret har tagit slut." : `Räkenskapsåret pågår till ${fy.end.toISOString().slice(0, 10)}.` },
    { ok: !prev || !!prev.closedAt, blocking: true, text: !prev || prev.closedAt ? "Tidigare räkenskapsår är stängda." : `Gör bokslut för ${fyLabel(prev)} först.` },
    { ok: unbookedUploads === 0, blocking: false, text: unbookedUploads ? `${unbookedUploads} underlag är inte bokförda.` : "Alla uppladdade underlag är bokförda.", href: "/uploads" },
    { ok: pendingExpenses === 0, blocking: false, text: pendingExpenses ? `${pendingExpenses} utlägg är inte bokförda.` : "Alla utlägg är bokförda.", href: "/expenses" },
    {
      ok: openVat.length === 0,
      blocking: false,
      text: openVat.length ? `${openVat.length} momsperiod(er) i året är inte avstämda och låsta.` : "Momsen för året är avstämd.",
      href: "/vat",
    },
  ];
  if (company.accountingMethod === "cash") {
    checks.push({
      ok: unpaidCash === 0,
      blocking: false,
      text: unpaidCash
        ? `Kontantmetoden: ${unpaidCash} obetalda kundfakturor ska bokföras som fordringar (1510) per bokslutsdagen. Gör det med ett manuellt verifikat.`
        : "Inga obetalda kundfakturor vid årets slut.",
      href: "/invoices?status=sent",
    });
  }

  // Resultat före skatt = intäkter - kostnader exklusive skatt (89xx) och redan bokfört bokslut (8999).
  const resultBeforeTax = -sumRange(bal, 3000, 8899);
  const bookedTax = sumRange(bal, 8900, 8989);
  const nonDeductible = NON_DEDUCTIBLE.reduce((s, n) => s + (bal.get(n) ?? 0), 0);
  // Skattemässigt resultat avrundas nedåt till helt hundratal kronor.
  const taxable = Math.max(0, Math.floor((resultBeforeTax + nonDeductible) / 10000) * 10000);
  const suggestedTax = hasCorporateTax(company) ? Math.max(0, Math.round((taxable * CORPORATE_TAX_RATE) / 100) * 100 - bookedTax) : 0;
  const tax = hasCorporateTax(company) ? Math.max(0, taxOverride ?? suggestedTax) : 0;
  const result = resultBeforeTax - bookedTax - tax;

  const ra = resultAccount(company);
  const entries: { title: string; date: Date; lines: LineInput[] }[] = [];
  if (tax > 0) {
    entries.push({ title: "Beräknad skatt på årets resultat", date: fy.end, lines: [{ account: 8910, debit: tax }, { account: 2512, credit: tax }] });
  }
  if (result !== 0) {
    entries.push({
      title: `Årets resultat ${fyLabel(fy)}`,
      date: fy.end,
      lines: result > 0 ? [{ account: 8999, debit: result }, { account: ra, credit: result }] : [{ account: ra, debit: -result }, { account: 8999, credit: -result }],
    });
  }

  return {
    company,
    fy,
    prev,
    checks,
    canClose: checks.every((c) => c.ok || !c.blocking) && !fy.closedAt,
    resultBeforeTax,
    nonDeductible,
    taxable,
    bookedTax,
    suggestedTax,
    tax,
    result,
    hasTax: hasCorporateTax(company),
    entries,
    nextStart: addMonths(fy.end, 1),
  };
}

/**
 * Omföring av eget kapital vid nästa års början (blir ingående balanser):
 * AB/ekonomisk förening: 2099 Årets resultat → 2098 Vinst eller förlust från föregående år.
 * Enskild firma/handelsbolag: 2013 uttag, 2018 insättningar och 2019 årets resultat → 2010 Eget kapital.
 */
export function carryForwardLines(company: Company, bal: Map<number, number>): LineInput[] {
  const lines: LineInput[] = [];
  const target = hasCorporateTax(company) ? 2098 : 2010;
  const sources = hasCorporateTax(company) ? [2099] : [2013, 2018, 2019];
  let net = 0;
  for (const n of sources) {
    const b = bal.get(n) ?? 0;
    if (!b) continue;
    net += b;
    lines.push(b > 0 ? { account: n, credit: b } : { account: n, debit: -b });
  }
  if (net) lines.push(net > 0 ? { account: target, debit: net } : { account: target, credit: -net });
  return lines;
}

/** Bokför bokslutet, för över resultatet till nästa år och stänger räkenskapsåret. */
export async function closeFiscalYear(companyId: number, fyId: number, taxOverride?: number) {
  const p = await closingPreview(companyId, fyId, taxOverride);
  if (p.fy.closedAt) throw new AccountingError("Räkenskapsåret är redan stängt.");
  const blocker = p.checks.find((c) => c.blocking && !c.ok);
  if (blocker) throw new AccountingError(blocker.text);

  return db.$transaction(async (t) => {
    const ids: number[] = [];
    for (const e of p.entries) {
      const v = await createVerification(t, companyId, { date: e.date, description: e.title, lines: e.lines, ignoreVatLock: true });
      ids.push(v.id);
    }
    // Nästa räkenskapsår skapas om det saknas; omföringen dateras på dess första dag.
    await ensureFiscalYearFor(t, companyId, p.nextStart);
    const bal = await balances(companyId, { to: p.fy.end }, t);
    const carry = carryForwardLines(p.company, bal);
    if (carry.length) {
      const v = await createVerification(t, companyId, {
        date: p.nextStart,
        description: `Omföring av föregående års resultat (${fyLabel(p.fy)})`,
        lines: carry,
        ignoreVatLock: true,
      });
      ids.push(v.id);
    }
    await t.fiscalYear.update({ where: { id: p.fy.id }, data: { closedAt: new Date(), closingVerificationIds: ids } });
    return { ids, result: p.result, tax: p.tax };
  });
}

/** Ångrar bokslutet: öppnar året igen och makulerar bokslutsverifikaten med omvända verifikat. */
export async function reopenFiscalYear(companyId: number, fyId: number) {
  const years = await fiscalYears(companyId);
  const i = years.findIndex((y) => y.id === fyId);
  const fy: FiscalYear | undefined = years[i];
  if (!fy || !fy.closedAt) throw new AccountingError("Räkenskapsåret är inte stängt.");
  if (years[i + 1]?.closedAt) throw new AccountingError("Öppna senare räkenskapsår först.");

  await db.fiscalYear.update({ where: { id: fy.id }, data: { closedAt: null } });
  for (const id of [...fy.closingVerificationIds].reverse()) {
    const v = await db.verification.findFirst({ where: { id, companyId } });
    if (v && !v.reversedById) await reverseVerification(companyId, id, undefined, { ignoreVatLock: true });
  }
  await db.fiscalYear.update({ where: { id: fy.id }, data: { closingVerificationIds: [] } });
}

/** Ingående balanser kan bara anges för det första räkenskapsåret; senare år får dem från bokslutet. */
export async function openingBalanceVerification(companyId: number, fy: FiscalYear) {
  return db.verification.findFirst({
    where: { companyId, fiscalYearId: fy.id, series: IB_SERIES, reversedById: null },
    include: { lines: { orderBy: { accountNumber: "asc" } } },
  });
}

/** Sparar (ersätter) ingående balanser för första räkenskapsåret. */
export async function saveOpeningBalances(companyId: number, rows: { account: number; amount: number }[]) {
  const years = await fiscalYears(companyId);
  const first = years[0];
  if (!first) throw new AccountingError("Det finns inget räkenskapsår.");
  if (first.closedAt) throw new AccountingError("Räkenskapsåret är stängt och ingående balanser kan inte ändras.");
  const lines: LineInput[] = rows
    .filter((r) => r.amount !== 0)
    .map((r) => {
      if (!(r.account >= 1000 && r.account <= 2999)) throw new AccountingError(`Konto ${r.account} är inget balanskonto (1000–2999).`);
      return r.amount > 0 ? { account: r.account, debit: r.amount } : { account: r.account, credit: -r.amount };
    });
  const known = new Set((await db.account.findMany({ where: { companyId, number: { in: lines.map((l) => l.account) } }, select: { number: true } })).map((a) => a.number));
  const missing = lines.find((l) => !known.has(l.account));
  if (missing) throw new AccountingError(`Kontot ${missing.account} finns inte i kontoplanen.`);
  const diff = lines.reduce((s, l) => s + (l.debit ?? 0) - (l.credit ?? 0), 0);
  if (diff !== 0) throw new AccountingError(`De ingående balanserna går inte jämnt ut (differens ${(diff / 100).toFixed(2)} kr). Tillgångar ska vara lika med eget kapital och skulder.`);

  return db.$transaction(async (t) => {
    const existing = await t.verification.findFirst({ where: { companyId, fiscalYearId: first.id, series: IB_SERIES } });
    if (existing) {
      // Ingående balanser är inte en händelse under året och får justeras tills året är stängt.
      await t.verificationLine.deleteMany({ where: { verificationId: existing.id } });
      if (lines.length === 0) {
        await t.verification.delete({ where: { id: existing.id } });
        return null;
      }
      await t.verificationLine.createMany({
        data: lines.map((l) => ({ verificationId: existing.id, companyId, accountNumber: l.account, debit: l.debit ?? 0, credit: l.credit ?? 0 })),
      });
      return existing;
    }
    if (lines.length === 0) return null;
    return createVerification(t, companyId, { date: first.start, description: "Ingående balanser", lines, series: IB_SERIES });
  });
}
