import type { FiscalYear, Prisma, PrismaClient } from "@prisma/client";
import { db } from "./db";

type Tx = Prisma.TransactionClient | PrismaClient;

export class FiscalError extends Error {}

/** Första dagen i månaden, `n` månader efter `d` (UTC). */
export const monthStart = (y: number, m0: number) => new Date(Date.UTC(y, m0, 1));
/** Sista dagen i månaden (UTC, midnatt). */
export const monthEnd = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0));
export const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
export const monthsBetween = (start: Date, end: Date) =>
  (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1;

/** "2026" för kalenderår, "2026/27" för brutet år, annars datumintervallet (t.ex. förlängt första år). */
export function fyLabel(fy: { start: Date; end: Date }) {
  const months = monthsBetween(fy.start, fy.end);
  const sy = fy.start.getUTCFullYear();
  const ey = fy.end.getUTCFullYear();
  if (months === 12 && fy.start.getUTCMonth() === 0) return String(sy);
  if (months === 12) return `${sy}/${String(ey).slice(2)}`;
  return `${fy.start.toISOString().slice(0, 7)} – ${fy.end.toISOString().slice(0, 7)}`;
}

export function fyRange(fy: { start: Date; end: Date }) {
  return `${fy.start.toISOString().slice(0, 10)} – ${fy.end.toISOString().slice(0, 10)}`;
}

/** Räkenskapsåret som innehåller datumet (utan att skapa något). */
export const contains = (fy: { start: Date; end: Date }, d: Date) => fy.start <= d && d <= fy.end;

export async function fiscalYears(companyId: number, t: Tx = db) {
  return t.fiscalYear.findMany({ where: { companyId }, orderBy: { start: "asc" } });
}

/** Räkenskapsåret som pågår idag, annars det senaste. */
export async function currentFiscalYear(companyId: number, t: Tx = db): Promise<FiscalYear> {
  const all = await fiscalYears(companyId, t);
  const today = new Date(new Date().toISOString().slice(0, 10));
  return all.find((f) => contains(f, today)) ?? all[all.length - 1] ?? (await ensureFiscalYearFor(t, companyId, today));
}

/** Väljer räkenskapsår från en query-parameter (id), annars det aktuella. */
export async function pickFiscalYear(companyId: number, idParam: string | undefined) {
  const all = await fiscalYears(companyId);
  const chosen = all.find((f) => String(f.id) === idParam);
  return { all, fy: chosen ?? (await currentFiscalYear(companyId)) };
}

/**
 * Hittar räkenskapsåret för ett bokföringsdatum. Ligger datumet efter det senaste året skapas nästa år
 * automatiskt (12 månader i taget). Datum före första året eller i ett stängt år avvisas.
 */
export async function ensureFiscalYearFor(t: Tx, companyId: number, date: Date): Promise<FiscalYear> {
  const all = await fiscalYears(companyId, t);
  const hit = all.find((f) => contains(f, date));
  if (hit) {
    if (hit.closedAt) throw new FiscalError(`Räkenskapsåret ${fyLabel(hit)} är stängt. Välj ett datum i ett öppet räkenskapsår.`);
    return hit;
  }
  if (all.length === 0) {
    const company = await t.company.findUniqueOrThrow({ where: { id: companyId } });
    const m0 = company.fiscalStartMonth - 1;
    const y = date.getUTCMonth() >= m0 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
    const start = monthStart(y, m0);
    return t.fiscalYear.create({ data: { companyId, start, end: monthEnd(y, m0 + 11) } });
  }
  const first = all[0];
  const last = all[all.length - 1];
  if (date < first.start) {
    throw new FiscalError(
      `Datumet ligger före första räkenskapsåret (${fyRange(first)}). Ändra räkenskapsåret under Inställningar → Räkenskapsår och moms.`,
    );
  }
  // Skapa följande år tills datumet täcks, men högst två år framåt (skyddar mot felskrivna årtal).
  let prev = last;
  for (let i = 0; i < 2; i++) {
    const start = addMonths(prev.end, 1);
    const next = await t.fiscalYear.create({ data: { companyId, start, end: monthEnd(start.getUTCFullYear(), start.getUTCMonth() + 11) } });
    if (contains(next, date)) return next;
    prev = next;
  }
  throw new FiscalError("Datumet ligger för långt fram i tiden. Kontrollera årtalet.");
}

/** Skapar första räkenskapsåret för ett nytt företag. */
export async function createFirstFiscalYear(t: Tx, companyId: number, startMonth: number, today = new Date()) {
  const m0 = Math.min(12, Math.max(1, startMonth)) - 1;
  const y = today.getUTCMonth() >= m0 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  return t.fiscalYear.create({ data: { companyId, start: monthStart(y, m0), end: monthEnd(y, m0 + 11) } });
}
