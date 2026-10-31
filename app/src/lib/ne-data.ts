import "server-only";
import { db } from "./db";
import { balances } from "./accounting";
import { NE_CODES, NE_FROM, NE_NONE, NE_TO, computeNe, type NeChoice } from "./ne";

/** Läser bokföringen för ett räkenskapsår och räknar fram underlaget till NE-bilagan. */
export async function loadNe(companyId: number, fy: { start: Date; end: Date }) {
  const [bal, accounts, maps] = await Promise.all([
    balances(companyId, { from: fy.start, to: fy.end }),
    db.account.findMany({ where: { companyId, number: { gte: NE_FROM, lte: NE_TO } }, select: { number: true, name: true, vatCode: true } }),
    db.neMapping.findMany({ where: { companyId } }),
  ]);
  const overrides = new Map<number, NeChoice>();
  for (const m of maps) if (m.field === NE_NONE || (NE_CODES as string[]).includes(m.field)) overrides.set(m.account, m.field as NeChoice);
  return computeNe(bal, new Map(accounts.map((a) => [a.number, { name: a.name, vatCode: a.vatCode }])), overrides);
}
