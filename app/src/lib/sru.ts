/**
 * SRU-filer för NE-bilagan (Skatteverkets filöverföring av inkomstdeklaration).
 * Specifikation: https://www.skatteverket.se/foretag/inkomstdeklaration/forredovisningsbyraer/tekniskinformationomfiloverforing.4.13948c0e18e810bfa0cca8.html
 *
 * - INFO.SRU innehåller uppgiftslämnaren, BLANKETTER.SRU själva blankettblocken. Båda filerna laddas upp tillsammans.
 * - Teckenuppsättning ISO 8859-1, en post per rad, belopp i hela kronor (negativa med "-" först).
 * - Poster utan värde lämnas inte, så fält med 0 kr tas inte med.
 */
import { NE_BALANCE_CODES, NE_CODES, type NeBalanceField, type NeField, type NeResult } from "./ne";

/** Fältkoder för NE enligt BAS/Skatteverkets kopplingstabell (B = balansräkning, R = resultaträkning). */
export const NE_SRU_CODES: Record<NeBalanceField | NeField | "R11", string> = {
  B1: "7200", B2: "7210", B3: "7211", B4: "7212", B5: "7213",
  B6: "7240", B7: "7250", B8: "7260", B9: "7280",
  B10: "7300", B11: "7320", B12: "7330",
  B13: "7380", B14: "7381", B15: "7382", B16: "7383",
  R1: "7400", R2: "7401", R3: "7402", R4: "7403",
  R5: "7500", R6: "7501", R7: "7502", R8: "7503", R9: "7504", R10: "7505",
  R11: "7440",
};
/** Fältkoder för räkenskapsårets första och sista dag. */
const FY_START = "7011";
const FY_END = "7012";

export const SRU_INFO_FILE = "INFO.SRU";
export const SRU_BLANKETTER_FILE = "BLANKETTER.SRU";

export class SruError extends Error {}

export type SruCompany = { name: string; orgNumber: string; address: string; postalCode: string; city: string; email: string };

/** Datum och klockslag i svensk tid som ÅÅÅÅMMDD och TTMMSS. */
export function sruStamp(now: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}${p.month}${p.day}`, time: `${p.hour}${p.minute}${p.second}` };
}

export const sruDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

/**
 * Beskattningsperiod för blankettyp, t.ex. "2025P4". Året är det år räkenskapsåret slutar och P1–P4 anger
 * slutmånad: P1 jan–apr, P2 maj–jun, P3 jul–aug, P4 sep–dec (kalenderår = P4).
 */
export function sruPeriod(fyEnd: Date) {
  const m = fyEnd.getUTCMonth() + 1;
  const p = m <= 4 ? 1 : m <= 6 ? 2 : m <= 8 ? 3 : 4;
  return `${fyEnd.getUTCFullYear()}P${p}`;
}

/**
 * Person-/organisationsnummer som tolv siffror utan bindestreck: sekelsiffror före personnummer (19/20, "+" ger
 * 100 år äldre) och 16 före organisationsnummer. Returnerar null om numret inte har 10 eller 12 siffror.
 */
export function sruOrgNumber(input: string, today = new Date()): string | null {
  const d = input.replace(/\D/g, "");
  if (d.length === 12) return d;
  if (d.length !== 10) return null;
  if (Number(d.slice(2, 4)) >= 20) return `16${d}`; // juridisk person (tredje siffran minst 2)
  const nowYear = today.getUTCFullYear();
  let year = Math.floor(nowYear / 100) * 100 + Number(d.slice(0, 2));
  if (year > nowYear) year -= 100;
  if (input.includes("+")) year -= 100;
  return `${year}${d.slice(2)}`;
}

/** Text till en post: utan #, radbrytningar och tecken utanför ISO 8859-1, högst 250 tecken. */
const clean = (s: string) =>
  s
    .replace(/[#\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7e\u00a0-\u00ff]/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 250);

/** Kontrollerar uppgifterna som INFO.SRU kräver. Skatteverket avvisar hela överföringen om de saknas. */
export function sruCompanyProblems(c: SruCompany): string[] {
  const problems: string[] = [];
  if (!clean(c.name)) problems.push("företagets namn");
  if (!sruOrgNumber(c.orgNumber)) problems.push("ett personnummer eller organisationsnummer med 10 siffror");
  if (!/^\d{5}$/.test(c.postalCode.replace(/\s/g, ""))) problems.push("ett postnummer med 5 siffror");
  if (!clean(c.city)) problems.push("postort");
  return problems;
}

const lines = (rows: string[]) => rows.join("\r\n") + "\r\n";

export function buildInfoSru(c: SruCompany, now = new Date(), program = "bokio-rea"): string {
  const problems = sruCompanyProblems(c);
  if (problems.length) throw new SruError(`Fyll i ${problems.join(", ")} under företagets inställningar.`);
  const { date, time } = sruStamp(now);
  const rows = [
    "#DATABESKRIVNING_START",
    "#PRODUKT SRU",
    `#SKAPAD ${date} ${time}`,
    `#PROGRAM ${clean(program)}`,
    `#FILNAMN ${SRU_BLANKETTER_FILE}`,
    "#DATABESKRIVNING_SLUT",
    "#MEDIELEV_START",
    `#ORGNR ${sruOrgNumber(c.orgNumber, now)}`,
    `#NAMN ${clean(c.name)}`,
  ];
  if (clean(c.address)) rows.push(`#ADRESS ${clean(c.address)}`);
  rows.push(`#POSTNR ${c.postalCode.replace(/\s/g, "")}`, `#POSTORT ${clean(c.city)}`);
  if (clean(c.email)) rows.push(`#EMAIL ${clean(c.email)}`);
  rows.push("#MEDIELEV_SLUT");
  return lines(rows);
}

export function buildBlanketterSru(c: SruCompany, ne: NeResult, fy: { start: Date; end: Date }, now = new Date()): string {
  const problems = sruCompanyProblems(c);
  if (problems.length) throw new SruError(`Fyll i ${problems.join(", ")} under företagets inställningar.`);
  const { date, time } = sruStamp(now);
  const rows = [`#BLANKETT NE-${sruPeriod(fy.end)}`, `#IDENTITET ${sruOrgNumber(c.orgNumber, now)} ${date} ${time}`, `#NAMN ${clean(c.name)}`];
  rows.push(`#UPPGIFT ${FY_START} ${sruDate(fy.start)}`, `#UPPGIFT ${FY_END} ${sruDate(fy.end)}`);
  const amounts: [keyof typeof NE_SRU_CODES, number][] = [
    ...NE_BALANCE_CODES.map((k): [NeBalanceField, number] => [k, ne.balanceFields[k].kr]),
    ...NE_CODES.map((k): [NeField, number] => [k, ne.fields[k].kr]),
    ["R11", ne.result],
  ];
  for (const [field, kr] of amounts) {
    if (kr !== 0) rows.push(`#UPPGIFT ${NE_SRU_CODES[field]} ${kr}`);
  }
  rows.push("#BLANKETTSLUT", "#FIL_SLUT");
  return lines(rows);
}

/** Filinnehållet som ISO 8859-1. */
export const toLatin1 = (s: string) => Buffer.from(s, "latin1");
