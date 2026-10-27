// Läser kontoutdrag i CSV-format från svenska banker (Swedbank, SEB, Handelsbanken, Nordea, Länsförsäkringar,
// Danske Bank, ICA Banken, Skandia m.fl.). Kolumnerna hittas via rubrikerna; okända format kan mappas manuellt.
// Ren modul utan databas, så att den kan testas fristående.

export class BankCsvError extends Error {}

export type BankRow = { date: string; amount: number; text: string; reference: string; balance: number | null };

export type Mapping = { date: number; amount: number; text: number; reference: number; balance: number; credit: number };

export type ParsedCsv = {
  bank: string;
  headers: string[];
  mapping: Mapping;
  rows: BankRow[];
  skipped: number;
  warnings: string[];
};

/** UTF-8 om filen är giltig UTF-8, annars Windows-1252 (vanligt i äldre bankexporter). */
export function decodeCsv(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}

function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 30);
  let best = ";";
  let bestScore = -1;
  for (const d of [";", "\t", ",", "|"]) {
    const counts = sample.map((l) => splitLine(l, d).length).filter((n) => n > 1);
    if (!counts.length) continue;
    // Flest rader med samma (största) antal kolumner vinner.
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    const [cols, n] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const score = n * 10 + cols;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function splitLine(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"' && cur.trim() === "") {
      quoted = true;
      cur = "";
    } else if (c === d) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** Delar upp texten i rader med hänsyn till radbrytningar inom citattecken. */
function splitRows(text: string): string[] {
  const rows: string[] = [];
  let cur = "";
  let quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    if ((c === "\n" || c === "\r") && !quoted) {
      if (cur.trim()) rows.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) rows.push(cur);
  return rows;
}

const clean = (h: string) =>
  h
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^a-z0-9åäöéü/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Rubriker i prioritetsordning. Bokföringsdagen gäller före transaktionsdagen (pengarna lämnar kontot då).
const DATE = ["bokföringsdag", "bokföringsdatum", "bokförd", "bokförd datum", "reskontradatum", "transaktionsdag", "transaktionsdatum", "datum", "date", "booking date", "valutadag", "valutadatum"];
const AMOUNT = ["belopp", "belopp sek", "transaktionsbelopp", "summa", "amount", "belopp i sek"];
const DEBIT = ["uttag", "utgående", "debet", "ut", "withdrawal"];
const CREDIT = ["insättning", "insättningar", "inbetalning", "kredit", "in", "deposit"];
const TEXT = ["beskrivning", "text/mottagare", "text", "transaktionstext", "specifikation", "rubrik", "meddelande", "namn", "mottagare", "avsändare", "transaktionstyp", "description"];
const REF = ["referens", "meddelande", "ocr", "verifikationsnummer", "reference", "egen anteckning"];
const BALANCE = ["bokfört saldo", "saldo", "behållning", "balance", "saldo sek"];

function find(headers: string[], names: string[], exclude: number[] = []): number {
  const h = headers.map(clean);
  for (const n of names) {
    const i = h.findIndex((x, j) => !exclude.includes(j) && x === n);
    if (i >= 0) return i;
  }
  for (const n of names) {
    if (n.length < 5) continue; // korta ord som "in"/"ut" bara som hela rubriker
    const i = h.findIndex((x, j) => !exclude.includes(j) && x.startsWith(n));
    if (i >= 0) return i;
  }
  return -1;
}

function guessBank(headers: string[]): string {
  const h = new Set(headers.map(clean));
  if (h.has("radnummer") && h.has("clearingnummer")) return "Swedbank";
  if (h.has("text/mottagare") || (h.has("verifikationsnummer") && h.has("valutadatum"))) return "SEB";
  if (h.has("reskontradatum")) return "Handelsbanken";
  if (h.has("avsändare") && h.has("mottagare")) return "Nordea";
  if (h.has("transaktionstyp") && h.has("meddelande")) return "Länsförsäkringar";
  if (h.has("kategori") && h.has("underkategori")) return "Danske Bank";
  return "Bank";
}

/** Tolkar "-1 234,50", "−1.234,50", "1234.50", "1,234.50" och "-1234" till öre. */
export function parseAmount(s: string): number | null {
  let v = s.replace(/[\s  ]|kr|sek/gi, "").replace(/[−–]/g, "-");
  if (!v) return null;
  let neg = false;
  if (/^\(.*\)$/.test(v)) {
    neg = true;
    v = v.slice(1, -1);
  }
  if (v.endsWith("-")) {
    neg = true;
    v = v.slice(0, -1);
  }
  const lastComma = v.lastIndexOf(",");
  const lastDot = v.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Det tecken som kommer sist är decimaltecknet.
    v = lastComma > lastDot ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  } else if (lastComma >= 0) {
    v = v.split(",").length > 2 ? v.replace(/,/g, "") : v.replace(",", ".");
  } else if (v.split(".").length > 2) {
    v = v.replace(/\./g, "");
  }
  if (!/^[-+]?\d+(\.\d+)?$/.test(v)) return null;
  const n = Math.round(Number(v) * 100);
  return neg ? -n : n;
}

/** Tolkar ÅÅÅÅ-MM-DD, ÅÅÅÅMMDD, ÅÅ-MM-DD, ÅÅÅÅ/MM/DD och DD.MM.ÅÅÅÅ (eller DD/MM/ÅÅÅÅ). */
export function parseDate(s: string): string | null {
  const v = s.trim().slice(0, 10);
  let y: number, m: number, d: number;
  let r: RegExpMatchArray | null;
  if ((r = v.match(/^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})$/))) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = v.match(/^(\d{2})-(\d{2})-(\d{2})$/))) [y, m, d] = [2000 + +r[1], +r[2], +r[3]];
  else if ((r = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/))) [y, m, d] = [+r[3], +r[2], +r[1]];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Läser ett kontoutdrag. `override` ersätter de kolumner som hittats automatiskt (index, -1 = ingen).
 * `invert` vänder tecknet (för exporter där uttag är positiva, t.ex. vissa kortkonton).
 */
export function parseBankCsv(text: string, opts: { override?: Partial<Mapping>; invert?: boolean } = {}): ParsedCsv {
  const lines = splitRows(text);
  if (lines.length < 2) throw new BankCsvError("Filen innehåller inga transaktioner.");
  const d = detectDelimiter(lines);
  const table = lines.map((l) => splitLine(l, d));

  // Rubrikraden: den första av de första 20 raderna där både ett datum och ett belopp kan hittas.
  let headerAt = -1;
  for (let i = 0; i < Math.min(20, table.length); i++) {
    const h = table[i];
    if (find(h, DATE) >= 0 && (find(h, AMOUNT) >= 0 || find(h, DEBIT) >= 0 || find(h, CREDIT) >= 0)) {
      headerAt = i;
      break;
    }
  }
  // Utan rubriker: anta att varje rad börjar med ett datum (t.ex. vissa Handelsbanken- och Skandia-filer).
  const headerless = headerAt < 0;
  const width = Math.max(...table.slice(0, 30).map((r) => r.length));
  const headers = headerless ? Array.from({ length: width }, (_, i) => `Kolumn ${i + 1}`) : table[headerAt];
  const body = table.slice(headerless ? 0 : headerAt + 1);

  let mapping: Mapping;
  if (headerless) {
    // Gissa kolumner utifrån innehållet: första datumkolumnen, sista beloppet före saldot, längsta texten.
    const sample = body.filter((r) => r.length === width).slice(0, 20);
    const isDate = (i: number) => sample.length > 0 && sample.every((r) => parseDate(r[i] ?? "") !== null);
    const isAmount = (i: number) => sample.length > 0 && sample.every((r) => parseAmount(r[i] ?? "") !== null);
    const cols = headers.map((_, i) => i);
    const date = cols.find(isDate) ?? -1;
    const amounts = cols.filter((i) => i !== date && !isDate(i) && isAmount(i));
    const textCol = cols
      .filter((i) => i !== date && !amounts.includes(i))
      .sort((a, b) => sample.reduce((s, r) => s + (r[b]?.length ?? 0), 0) - sample.reduce((s, r) => s + (r[a]?.length ?? 0), 0))[0];
    mapping = {
      date,
      amount: amounts.length >= 2 ? amounts[amounts.length - 2] : (amounts[0] ?? -1),
      balance: amounts.length >= 2 ? amounts[amounts.length - 1] : -1,
      text: textCol ?? -1,
      reference: -1,
      credit: -1,
    };
  } else {
    const date = find(headers, DATE);
    let amount = find(headers, AMOUNT);
    let credit = -1;
    if (amount < 0) {
      // Separata kolumner för uttag och insättning.
      amount = find(headers, DEBIT);
      credit = find(headers, CREDIT);
      if (amount < 0) [amount, credit] = [credit, -1];
    }
    const balance = find(headers, BALANCE, [amount, credit]);
    const textCol = find(headers, TEXT, [date, amount, credit, balance]);
    const reference = find(headers, REF, [date, amount, credit, balance, textCol]);
    mapping = { date, amount, text: textCol, reference, balance, credit };
  }
  mapping = { ...mapping, ...Object.fromEntries(Object.entries(opts.override ?? {}).filter(([, v]) => typeof v === "number" && v >= -1 && v < headers.length)) };
  if (mapping.date < 0 || mapping.amount < 0) {
    throw new BankCsvError(`Hittade inte kolumnerna för datum och belopp. Rubriker i filen: ${headers.filter(Boolean).join(", ") || "inga"}.`);
  }

  const rows: BankRow[] = [];
  let skipped = 0;
  const currency = find(headers, ["valuta", "currency"]);
  const foreign = new Set<string>();
  for (const r of body) {
    if (r.every((c) => !c)) continue;
    const date = parseDate(r[mapping.date] ?? "");
    let amount = parseAmount(r[mapping.amount] ?? "");
    if (mapping.credit >= 0) {
      // Uttag och insättning i olika kolumner: uttag blir negativa oavsett hur de skrivs.
      const out = amount;
      const inn = parseAmount(r[mapping.credit] ?? "");
      amount = out ? -Math.abs(out) : inn ? Math.abs(inn) : out === 0 || inn === 0 ? 0 : null;
    }
    if (!date || amount === null) {
      skipped++;
      continue;
    }
    if (amount === 0) continue;
    if (currency >= 0 && r[currency] && !/^sek$/i.test(r[currency])) foreign.add(r[currency].toUpperCase());
    const text = (mapping.text >= 0 ? r[mapping.text] : "") || (mapping.reference >= 0 ? r[mapping.reference] : "") || "Banktransaktion";
    rows.push({
      date,
      amount: opts.invert ? -amount : amount,
      text: text.replace(/\s+/g, " ").slice(0, 200),
      reference: mapping.reference >= 0 && r[mapping.reference] !== text ? (r[mapping.reference] ?? "").slice(0, 200) : "",
      balance: mapping.balance >= 0 ? parseAmount(r[mapping.balance] ?? "") : null,
    });
  }
  if (!rows.length) throw new BankCsvError("Inga transaktioner kunde läsas. Kontrollera att kolumnerna för datum och belopp är rätt.");

  const warnings: string[] = [];
  if (foreign.size) warnings.push(`Filen innehåller belopp i ${[...foreign].join(", ")}. Kapima Bokför bokför i kronor – kontrollera de raderna.`);
  if (skipped) warnings.push(`${skipped} rader utan giltigt datum eller belopp hoppades över (t.ex. summeringsrader).`);
  return { bank: headerless ? "Bank (utan rubriker)" : guessBank(headers), headers, mapping, rows, skipped, warnings };
}
