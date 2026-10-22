import { db } from "./db";
import { AccountingError, IB_SERIES, balances, createVerification, type LineInput } from "./accounting";
import type { Company } from "@prisma/client";
import { VAT_SETTLEMENT } from "./bas";
import { contains, fiscalYears } from "./fiscal";

export type VatBox = { box: string; label: string; amount: number };

const OUTPUT_VAT_ACCOUNTS = [2611, 2614, 2621, 2631];
const INPUT_VAT_ACCOUNTS = [2641, 2645];

export function quarterOf(date: Date) {
  const y = date.getUTCFullYear();
  const q = Math.floor(date.getUTCMonth() / 3);
  return {
    start: new Date(Date.UTC(y, q * 3, 1)),
    end: new Date(Date.UTC(y, q * 3 + 3, 0)),
  };
}

export type VatCompany = Pick<Company, "vatPeriod" | "companyType" | "euTrade">;
export type VatPeriodRow = { start: Date; end: Date; deadline: Date; lockedAt: Date | null; current: boolean };

export const VAT_FREQUENCIES = {
  month: "Månad",
  quarter: "Kvartal",
  year: "Helår (räkenskapsår)",
  none: "Ej momsregistrerad",
} as const;

const d = (y: number, m0: number, day: number) => new Date(Date.UTC(y, m0, day));

/** Den 12:e i angiven månad, utom i januari och augusti då det är den 17:e (Skatteverket). */
function twelfth(y: number, m0: number) {
  const x = d(y, m0, 1);
  return d(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCMonth() === 0 || x.getUTCMonth() === 7 ? 17 : 12);
}
/** Den 26:e i angiven månad, utom i december då det är den 27:e. */
function twentySixth(y: number, m0: number) {
  const x = d(y, m0, 1);
  return d(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCMonth() === 11 ? 27 : 26);
}

/**
 * Sista dag att deklarera och betala moms enligt Skatteverket (digital inlämning).
 * Månads- och kvartalsmoms: den 12:e i andra månaden efter perioden (17:e i januari och augusti).
 * Helårsmoms beror på företagsform och EU-handel.
 */
export function deadline(period: { end: Date }, company: VatCompany): Date {
  const ey = period.end.getUTCFullYear();
  const em = period.end.getUTCMonth();
  if (company.vatPeriod !== "year") return twelfth(ey, em + 2);
  if (company.companyType === "ef") return company.euTrade ? d(ey + 1, 1, 26) : d(ey + 1, 4, 12);
  if (company.companyType === "hb" || company.euTrade) return twentySixth(ey, em + 2);
  // Aktiebolag och ekonomiska föreningar utan EU-handel: beror på när räkenskapsåret slutar.
  if (em <= 3) return d(ey, 11, 12); // jan–apr → 12 december
  if (em <= 5) return d(ey + 1, 0, 17); // maj–jun → 17 januari
  if (em <= 7) return d(ey + 1, 3, 12); // jul–aug → 12 april
  return d(ey + 1, 7, 17); // sep–dec → 17 augusti
}

export const periodLabel = (p: { start: Date; end: Date }) => {
  const f = (x: Date) => x.toLocaleDateString("sv-SE", { month: "long", year: "numeric", timeZone: "UTC" });
  const a = f(p.start);
  const b = f(p.end);
  return a === b ? a : `${a} – ${b}`;
};

/** Momsavstämningsverifikat ska inte räknas med i själva momsrapporten. */
async function settlementIds(companyId: number) {
  const ps = await db.vatPeriod.findMany({ where: { companyId, verificationId: { not: null } }, select: { verificationId: true } });
  return ps.map((p) => p.verificationId!);
}

export async function vatReport(companyId: number, start: Date, end: Date) {
  const [excludeIds, accounts] = await Promise.all([
    settlementIds(companyId),
    db.account.findMany({ where: { companyId, number: { gte: 3000, lte: 3999 } }, select: { number: true, vatCode: true } }),
  ]);
  const b = await balances(companyId, { from: start, to: end, excludeIds, series: { notIn: [IB_SERIES] } });
  const credit = (n: number) => -(b.get(n) ?? 0);
  const debit = (n: number) => b.get(n) ?? 0;

  const taxableSales = accounts
    .filter((a) => ["25", "12", "6"].includes(a.vatCode))
    .reduce((s, a) => s + credit(a.number), 0);

  const boxes: VatBox[] = [
    { box: "05", label: "Momspliktig försäljning som inte ingår i annan ruta", amount: taxableSales },
    { box: "10", label: "Utgående moms 25 %", amount: credit(2611) },
    { box: "11", label: "Utgående moms 12 %", amount: credit(2621) },
    { box: "12", label: "Utgående moms 6 %", amount: credit(2631) },
    { box: "21", label: "Inköp av tjänster från annat EU-land", amount: debit(4535) },
    { box: "22", label: "Inköp av tjänster från land utanför EU", amount: debit(4531) },
    { box: "30", label: "Utgående moms 25 % (omvänd skattskyldighet)", amount: credit(2614) },
    { box: "35", label: "Försäljning av varor till annat EU-land", amount: credit(3108) },
    { box: "39", label: "Försäljning av tjänster till annat EU-land", amount: credit(3308) },
    { box: "40", label: "Övrig försäljning av tjänster utanför Sverige", amount: credit(3305) + credit(3105) },
    { box: "41", label: "Försäljning när köparen är betalningsskyldig i Sverige", amount: credit(3231) },
    { box: "42", label: "Övrig försäljning m.m.", amount: credit(3004) },
    { box: "48", label: "Ingående moms att dra av", amount: debit(2641) + debit(2645) },
  ];
  const outVat = OUTPUT_VAT_ACCOUNTS.reduce((s, n) => s + credit(n), 0);
  const inVat = INPUT_VAT_ACCOUNTS.reduce((s, n) => s + debit(n), 0);
  // Skatteverket avrundar till hela kronor.
  const toPay = Math.round((outVat - inVat) / 100) * 100;
  boxes.push({ box: "49", label: toPay >= 0 ? "Moms att betala" : "Moms att få tillbaka", amount: toPay });
  return { boxes, outVat, inVat, toPay, balances: b };
}

/**
 * Momsperioderna för företaget, nyaste först: redan låsta perioder (oavsett tidigare inställning)
 * följt av perioder enligt nuvarande redovisningsperiod fram till och med den pågående.
 */
export async function vatPeriods(companyId: number): Promise<VatPeriodRow[]> {
  const [company, stored, fys] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: companyId } }),
    db.vatPeriod.findMany({ where: { companyId, lockedAt: { not: null } }, orderBy: { start: "asc" } }),
    fiscalYears(companyId),
  ]);
  const today = new Date(new Date().toISOString().slice(0, 10));
  const rows: VatPeriodRow[] = stored.map((p) => ({ start: p.start, end: p.end, lockedAt: p.lockedAt, deadline: deadline(p, company), current: false }));
  if (company.vatPeriod === "none" || fys.length === 0) return rows.reverse();

  const lastLocked = stored[stored.length - 1];
  let from = lastLocked ? new Date(lastLocked.end.getTime() + 86400000) : fys[0].start;
  // Generera perioder till och med den som pågår idag.
  while (from <= today) {
    let end: Date;
    if (company.vatPeriod === "month") end = d(from.getUTCFullYear(), from.getUTCMonth() + 1, 0);
    else if (company.vatPeriod === "quarter") end = quarterOf(from).end;
    else end = fys.find((f) => contains(f, from))?.end ?? d(from.getUTCFullYear(), from.getUTCMonth() + 12, 0);
    rows.push({ start: from, end, lockedAt: null, deadline: deadline({ end }, company), current: contains({ start: from, end }, today) });
    from = new Date(end.getTime() + 86400000);
  }
  return rows.reverse();
}

/** Stämmer av momsen: nollställer momskontona mot 2650 och låser perioden. */
export async function closeVatPeriod(companyId: number, start: Date) {
  const periods = (await vatPeriods(companyId)).reverse();
  const period = periods.find((p) => p.start.getTime() === start.getTime());
  if (!period) throw new AccountingError("Momsperioden finns inte.");
  if (period.lockedAt) throw new AccountingError("Perioden är redan låst.");
  if (period.current || period.end >= new Date(new Date().toISOString().slice(0, 10))) throw new AccountingError("Perioden pågår fortfarande.");
  const firstOpen = periods.find((p) => !p.lockedAt);
  if (firstOpen && firstOpen.start < period.start) throw new AccountingError("Lås tidigare momsperioder först (de deklareras i tur och ordning).");
  const end = period.end;
  return db.$transaction(async (tx) => {

    const b = await balances(companyId, { from: start, to: end }, tx);
    const lines: LineInput[] = [];
    let net = 0;
    for (const n of [...OUTPUT_VAT_ACCOUNTS, ...INPUT_VAT_ACCOUNTS]) {
      const bal = b.get(n) ?? 0;
      if (!bal) continue;
      net += bal;
      lines.push(bal > 0 ? { account: n, credit: bal } : { account: n, debit: -bal });
    }
    let verificationId: number | null = null;
    if (lines.length) {
      // Skatteverket räknar i hela kronor; öresdifferensen bokförs som öresutjämning (3740).
      const toPay = Math.round(-net / 100) * 100;
      lines.push(toPay > 0 ? { account: VAT_SETTLEMENT, credit: toPay } : { account: VAT_SETTLEMENT, debit: -toPay });
      const rounding = net + toPay;
      if (rounding) lines.push(rounding > 0 ? { account: 3740, debit: rounding } : { account: 3740, credit: -rounding });
      const label = `${start.toISOString().slice(0, 7)} – ${end.toISOString().slice(0, 7)}`;
      const v = await createVerification(tx, companyId, { date: end, description: `Momsredovisning ${label}`, lines });
      verificationId = v.id;
    }
    await tx.vatPeriod.upsert({
      where: { companyId_start_end: { companyId, start, end } },
      create: { companyId, start, end, lockedAt: new Date(), verificationId },
      update: { lockedAt: new Date(), verificationId },
    });
  });
}
