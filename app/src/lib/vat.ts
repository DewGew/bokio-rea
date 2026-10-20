import { db } from "./db";
import { AccountingError, balances, createVerification, type LineInput } from "./accounting";
import { VAT_SETTLEMENT } from "./bas";

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

/** Sista dag att deklarera kvartalsmoms (förenklat: den 12:e i andra månaden efter perioden, aug = 17). */
export function deadline(end: Date) {
  const m = end.getUTCMonth() + 2;
  const d = new Date(Date.UTC(end.getUTCFullYear(), m, 12));
  if (d.getUTCMonth() === 7) d.setUTCDate(17);
  return d;
}

/** Momsavstämningsverifikat ska inte räknas med i själva momsrapporten. */
async function settlementIds(companyId: number) {
  const ps = await db.vatPeriod.findMany({ where: { companyId, verificationId: { not: null } }, select: { verificationId: true } });
  return ps.map((p) => p.verificationId!);
}

export async function vatReport(companyId: number, start: Date, end: Date) {
  const b = await balances(companyId, { from: start, to: end, excludeIds: await settlementIds(companyId) });
  const accounts = await db.account.findMany({ where: { companyId, number: { gte: 3000, lte: 3999 } } });
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

export async function vatPeriods(companyId: number) {
  const first = await db.verification.findFirst({ where: { companyId }, orderBy: { date: "asc" } });
  const now = new Date();
  const startDate = first ? first.date : now;
  const stored = await db.vatPeriod.findMany({ where: { companyId } });
  const result: { start: Date; end: Date; deadline: Date; lockedAt: Date | null; current: boolean }[] = [];
  let { start, end } = quarterOf(startDate);
  while (start <= now) {
    const s = stored.find((p) => p.start.getTime() === start.getTime());
    result.push({ start, end, deadline: deadline(end), lockedAt: s?.lockedAt ?? null, current: end >= now });
    const next = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 1));
    ({ start, end } = quarterOf(next));
  }
  return result.reverse();
}

/** Stämmer av momsen: nollställer momskontona mot 2650 och låser perioden. */
export async function closeVatPeriod(companyId: number, start: Date, end: Date) {
  return db.$transaction(async (tx) => {
    const existing = await tx.vatPeriod.findUnique({ where: { companyId_start_end: { companyId, start, end } } });
    if (existing?.lockedAt) throw new AccountingError("Perioden är redan låst.");
    const first = await tx.verification.findFirst({ where: { companyId }, orderBy: { date: "asc" } });
    if (first) {
      const q0 = quarterOf(first.date).start;
      const earlierQuarters = (start.getUTCFullYear() - q0.getUTCFullYear()) * 4 + (start.getUTCMonth() - q0.getUTCMonth()) / 3;
      const lockedEarlier = await tx.vatPeriod.count({ where: { companyId, end: { lt: start }, lockedAt: { not: null } } });
      if (lockedEarlier < earlierQuarters) throw new AccountingError("Lås tidigare momsperioder först (de deklareras i tur och ordning).");
    }

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
