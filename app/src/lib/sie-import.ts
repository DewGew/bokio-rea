import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { AccountingError, IB_SERIES } from "./accounting";
import { fiscalYears, fyLabel, fyRange, monthsBetween } from "./fiscal";
import { quarterOf } from "./vat";
import type { SieFile } from "./sie";

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Verifikatserier sparas med högst 4 tecken (bokstäver/siffror); "IB" är reserverad för ingående balanser. */
const cleanSeries = (s: string) => {
  const x = s.toUpperCase().replace(/[^A-Z0-9ÅÄÖ]/g, "").slice(0, 4) || "A";
  return x === IB_SERIES ? "IBX" : x;
};

export type ImportPlan = {
  file: { program: string; companyName: string; orgNumber: string; year: string; start: string; end: string };
  orgMatches: boolean;
  fiscalYear: { action: "use" | "create-before" | "create-after" | "replace-empty"; label: string; existingVerifications: number; isFirst: boolean };
  counts: { accounts: number; newAccounts: number; verifications: number; transactions: number; ibAccounts: number; series: string[] };
  ibBalanced: boolean;
  unbalanced: { series: string; number: number | null; diff: number }[];
  outside: number;
  errors: string[];
  warnings: string[];
};

/** Analyserar en SIE-fil mot företaget utan att ändra något. */
export async function planImport(companyId: number, sie: SieFile): Promise<ImportPlan> {
  const year = sie.years.get(0)!;
  const [company, years, accounts] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: companyId } }),
    fiscalYears(companyId),
    db.account.findMany({ where: { companyId }, select: { number: true } }),
  ]);
  const errors: string[] = [];
  const warnings = [...sie.warnings];

  // Vilket räkenskapsår ska datan hamna i?
  const same = years.find((y) => y.start.getTime() === year.start.getTime());
  const counts = await db.verification.groupBy({ by: ["fiscalYearId"], where: { companyId, series: { not: IB_SERIES } }, _count: true });
  const countFor = (id: number) => counts.find((c) => c.fiscalYearId === id)?._count ?? 0;
  let action: ImportPlan["fiscalYear"]["action"] = "use";
  let existingVerifications = 0;
  let isFirst = false;
  if (same) {
    if (same.end.getTime() !== year.end.getTime()) errors.push(`Räkenskapsåret ${fyLabel(same)} har ett annat slutdatum (${iso(same.end)}) än filen (${iso(year.end)}).`);
    if (same.closedAt) errors.push(`Räkenskapsåret ${fyLabel(same)} är stängt.`);
    existingVerifications = countFor(same.id);
    isFirst = same.id === years[0].id;
  } else if (years.length === 1 && countFor(years[0].id) === 0 && !years[0].closedAt) {
    action = "replace-empty"; // nyregistrerat företag utan bokföring: årets datum ersätts med filens
    isFirst = true;
  } else if (years.length && year.end.getTime() + DAY === years[0].start.getTime()) {
    action = "create-before";
    isFirst = true;
  } else if (years.length && year.start.getTime() === years[years.length - 1].end.getTime() + DAY) {
    action = "create-after";
  } else {
    errors.push(
      `Filens räkenskapsår (${iso(year.start)} – ${iso(year.end)}) ansluter inte till dina räkenskapsår (${years.map(fyRange).join(", ")}). Importera åren i tur och ordning, äldsta först.`,
    );
  }
  if (action === "create-before") {
    // Det nuvarande första året får sina ingående balanser från det importerade året framöver.
    const manualIb = await db.verification.count({ where: { companyId, fiscalYearId: years[0].id, series: IB_SERIES } });
    if (manualIb) errors.push(`${fyLabel(years[0])} har manuellt angivna ingående balanser. Ta bort dem under Bokslut → Ingående balanser innan du importerar året före.`);
  }
  const months = monthsBetween(year.start, year.end);
  if (months < 1 || months > 18) errors.push("Filens räkenskapsår är längre än 18 månader.");

  const unbalanced = sie.vers
    .map((v) => ({ series: v.series, number: v.number, diff: v.lines.reduce((s, l) => s + l.amount, 0) }))
    .filter((v) => v.diff !== 0);
  if (unbalanced.length) errors.push(`${unbalanced.length} verifikat balanserar inte (debet ≠ kredit).`);
  const outside = sie.vers.filter((v) => v.date < year.start || v.date > year.end).length;
  if (outside) errors.push(`${outside} verifikat har datum utanför räkenskapsåret.`);
  if (existingVerifications && sie.vers.length) {
    errors.push(`Räkenskapsåret har redan ${existingVerifications} verifikat. Importera bara till ett tomt räkenskapsår för att undvika dubbletter.`);
  }

  const ibSum = [...sie.ib.entries()].filter(([a]) => a < 3000).reduce((s, [, v]) => s + v, 0);
  if (ibSum !== 0 && isFirst) warnings.push(`De ingående balanserna i filen går inte jämnt ut (differens ${(ibSum / 100).toFixed(2)} kr) och kan inte importeras.`);
  if (!isFirst && sie.ib.size) warnings.push("Ingående balanser importeras bara till det första räkenskapsåret. För senare år kommer de från bokslutet.");

  const cleanOrg = (s: string) => s.replace(/\D/g, "").slice(-10);
  const orgMatches = !sie.orgNumber || cleanOrg(sie.orgNumber) === cleanOrg(company.orgNumber);
  if (!orgMatches) warnings.push(`Filen gäller organisationsnummer ${sie.orgNumber}, men företaget har ${company.orgNumber}.`);

  const known = new Set(accounts.map((a) => a.number));
  const used = new Set([...sie.accounts.keys(), ...sie.vers.flatMap((v) => v.lines.map((l) => l.account)), ...sie.ib.keys()]);
  return {
    file: { program: sie.program, companyName: sie.companyName, orgNumber: sie.orgNumber, year: fyLabel(year), start: iso(year.start), end: iso(year.end) },
    orgMatches,
    fiscalYear: { action, label: fyLabel(year), existingVerifications, isFirst },
    counts: {
      accounts: sie.accounts.size,
      newAccounts: [...used].filter((a) => !known.has(a)).length,
      verifications: sie.vers.length,
      transactions: sie.vers.reduce((s, v) => s + v.lines.length, 0),
      ibAccounts: [...sie.ib.entries()].filter(([a, v]) => a < 3000 && v !== 0).length,
      series: [...new Set(sie.vers.map((v) => cleanSeries(v.series)))],
    },
    ibBalanced: ibSum === 0,
    unbalanced: unbalanced.slice(0, 10),
    outside,
    errors,
    warnings,
  };
}

export type ImportOptions = { accounts: boolean; openingBalances: boolean; verifications: boolean; lockVat: boolean; closeYear: boolean };

/** Genomför importen i en transaktion. Allt eller inget. */
export async function runImport(companyId: number, sie: SieFile, opts: ImportOptions) {
  const plan = await planImport(companyId, sie);
  if (plan.errors.length) throw new AccountingError(plan.errors[0]);
  const year = sie.years.get(0)!;

  return db.$transaction(
    async (t: Prisma.TransactionClient) => {
      const company = await t.company.findUniqueOrThrow({ where: { id: companyId } });
      const years = await fiscalYears(companyId, t);

      // 1. Räkenskapsår
      let fy = years.find((y) => y.start.getTime() === year.start.getTime());
      if (!fy && plan.fiscalYear.action === "replace-empty") {
        fy = await t.fiscalYear.update({ where: { id: years[0].id }, data: { start: year.start, end: year.end } });
      } else if (!fy) {
        fy = await t.fiscalYear.create({ data: { companyId, start: year.start, end: year.end } });
      }

      // 2. Konton: alla som används måste finnas; nya får namnet från filen.
      const used = new Set([...sie.vers.flatMap((v) => v.lines.map((l) => l.account)), ...sie.ib.keys()]);
      if (opts.accounts) for (const a of sie.accounts.keys()) used.add(a);
      const existing = new Set((await t.account.findMany({ where: { companyId }, select: { number: true } })).map((a) => a.number));
      const missing = [...used].filter((a) => !existing.has(a));
      if (missing.length) {
        await t.account.createMany({ data: missing.map((n) => ({ companyId, number: n, name: sie.accounts.get(n) || `Konto ${n}` })) });
      }

      // 3. Ingående balanser (bara första räkenskapsåret)
      let ibLines = 0;
      if (opts.openingBalances && plan.fiscalYear.isFirst && plan.ibBalanced && plan.counts.ibAccounts > 0) {
        const old = await t.verification.findFirst({ where: { companyId, fiscalYearId: fy.id, series: IB_SERIES } });
        if (old) await t.verification.delete({ where: { id: old.id } });
        const lines = [...sie.ib.entries()].filter(([a, v]) => a < 3000 && v !== 0);
        await t.verification.create({
          data: {
            companyId,
            fiscalYearId: fy.id,
            series: IB_SERIES,
            number: 1,
            date: fy.start,
            description: `Ingående balanser (import från ${sie.program.split(" ")[0]?.replace(/"/g, "") || "SIE"})`,
            lines: { create: lines.map(([a, v]) => ({ companyId, accountNumber: a, debit: Math.max(v, 0), credit: Math.max(-v, 0) })) },
          },
        });
        ibLines = lines.length;
      }

      // 4. Verifikat med originalserie och -nummer (nya nummer om de saknas eller krockar)
      let imported = 0;
      if (opts.verifications) {
        const taken = new Map<string, Set<number>>();
        const nextFree = (series: string) => {
          const set = taken.get(series) ?? new Set<number>();
          let n = 1;
          while (set.has(n)) n++;
          return n;
        };
        for (const v of [...sie.vers].sort((a, b) => a.date.getTime() - b.date.getTime() || (a.number ?? 0) - (b.number ?? 0))) {
          const series = cleanSeries(v.series);
          const set = taken.get(series) ?? new Set<number>();
          taken.set(series, set);
          const number = v.number && v.number > 0 && !set.has(v.number) ? v.number : nextFree(series);
          set.add(number);
          await t.verification.create({
            data: {
              companyId,
              fiscalYearId: fy.id,
              series,
              number,
              date: v.date,
              description: v.text || `Verifikat ${series}${number}`,
              lines: {
                create: v.lines
                  .filter((l) => l.amount !== 0)
                  .map((l) => ({ companyId, accountNumber: l.account, debit: Math.max(l.amount, 0), credit: Math.max(-l.amount, 0), text: l.text })),
              },
            },
          });
          imported++;
        }
      }

      // 5. Moms som redan är redovisad i det gamla systemet: lås periodens momsperioder utan avstämningsverifikat.
      let lockedVat = 0;
      if (opts.lockVat && company.vatPeriod !== "none") {
        const periods: { start: Date; end: Date }[] = [];
        if (company.vatPeriod === "year") periods.push({ start: fy.start, end: fy.end });
        else {
          let from = fy.start;
          while (from <= fy.end) {
            const end = company.vatPeriod === "month" ? new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)) : quarterOf(from).end;
            periods.push({ start: from, end: end > fy.end ? fy.end : end });
            from = new Date(end.getTime() + DAY);
          }
        }
        for (const p of periods) {
          await t.vatPeriod.upsert({
            where: { companyId_start_end: { companyId, start: p.start, end: p.end } },
            create: { companyId, start: p.start, end: p.end, lockedAt: new Date() },
            update: { lockedAt: new Date() },
          });
          lockedVat++;
        }
      }

      // 6. Stäng året (bokslutet är gjort i det gamla systemet).
      if (opts.closeYear) await t.fiscalYear.update({ where: { id: fy.id }, data: { closedAt: new Date() } });

      return { fiscalYear: fyLabel(fy), accountsCreated: missing.length, ibLines, verifications: imported, lockedVat, closed: opts.closeYear };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
