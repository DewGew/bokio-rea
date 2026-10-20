import { db } from "./db";
import { IB_SERIES, balances } from "./accounting";
import { fiscalYears, fyLabel } from "./fiscal";
import { buildSie, encodeCp437 } from "./sie";

/** Saldon vid årets början: allt före året plus årets ingående balanser (IB-serien). */
async function opening(companyId: number, fy: { start: Date; end: Date }) {
  const [before, ib] = await Promise.all([
    balances(companyId, { to: new Date(fy.start.getTime() - 1) }),
    balances(companyId, { from: fy.start, to: fy.end, series: { in: [IB_SERIES] } }),
  ]);
  for (const [a, v] of ib) before.set(a, (before.get(a) ?? 0) + v);
  return before;
}

/** Skapar en SIE 4-fil (CP437) för ett räkenskapsår, med föregående år som jämförelse. */
export async function exportSie(companyId: number, fyId: number) {
  const [company, years, accounts] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: companyId } }),
    fiscalYears(companyId),
    db.account.findMany({ where: { companyId }, orderBy: { number: "asc" }, select: { number: true, name: true } }),
  ]);
  const i = years.findIndex((y) => y.id === fyId);
  const fy = years[i];
  if (!fy) return null;
  const prev = years[i - 1];

  const [ib, ub, res, prevIb, prevUb, prevRes, vers] = await Promise.all([
    opening(companyId, fy),
    balances(companyId, { to: fy.end }),
    balances(companyId, { from: fy.start, to: fy.end }),
    prev ? opening(companyId, prev) : undefined,
    prev ? balances(companyId, { to: prev.end }) : undefined,
    prev ? balances(companyId, { from: prev.start, to: prev.end }) : undefined,
    db.verification.findMany({
      where: { companyId, fiscalYearId: fy.id, series: { not: IB_SERIES } },
      include: { lines: { orderBy: { id: "asc" } } },
      orderBy: [{ series: "asc" }, { number: "asc" }],
    }),
  ]);

  const text = buildSie({
    company,
    year: fy,
    prevYear: prev,
    accounts,
    ib,
    ub,
    res,
    prevIb,
    prevUb,
    prevRes,
    vers: vers.map((v) => ({
      series: v.series,
      number: v.number,
      date: v.date,
      text: v.description,
      created: v.createdAt,
      lines: v.lines.map((l) => ({ account: l.accountNumber, amount: l.debit - l.credit, text: l.text })),
    })),
  });
  const name = `${company.name}-${fyLabel(fy).replace(/[^\w-]+/g, "_")}.se`.replace(/[^\w.\-åäöÅÄÖ]+/g, "_");
  return { bytes: encodeCp437(text), name };
}
