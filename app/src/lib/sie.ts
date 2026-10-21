// SIE 4 – svenskt standardformat för överföring av bokföring (Fortnox, Visma, Bokio m.fl.).
// Specifikation: SIE-gruppen, "SIE filformat ver 4B". Filer kodas normalt i IBM PC8 (CP437).

// Övre halvan (0x80–0xFF) av teckentabell CP437.
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0";
const CP437_REVERSE = new Map([...CP437_HIGH].map((ch, i) => [ch, 0x80 + i]));

/** Typografiska tecken som saknas i CP437 ersätts med närmaste motsvarighet. */
const TRANSLIT: Record<string, string> = { "–": "-", "—": "-", "‘": "'", "’": "'", "‚": "'", "“": '"', "”": '"', "„": '"', "…": "...", "€": "EUR", "•": "*", " ": " ", " ": " " };

export function encodeCp437(input: string): Uint8Array {
  const text = input.replace(/[–—‘’‚“”„…€•  ]/g, (c) => TRANSLIT[c]);
  const out = new Uint8Array(text.length);
  let n = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out[n++] = code < 0x80 ? code : (CP437_REVERSE.get(ch) ?? 0x3f); // "?" för tecken som saknas
  }
  return out.subarray(0, n);
}

/** Avkodar en SIE-fil. Giltig UTF-8 (vissa program exporterar så) används direkt, annars CP437. */
export function decodeSie(bytes: Uint8Array): string {
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!/#FORMAT\s+PC8/i.test(utf8) || /[åäöÅÄÖ]/.test(utf8)) return utf8.replace(/^\uFEFF/, "");
  } catch {
    // inte UTF-8
  }
  let s = "";
  for (const b of bytes) s += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  return s;
}

// ---------------------------------------------------------------- Tolkning

export type SieTrans = { account: number; amount: number; text: string };
export type SieVer = { series: string; number: number | null; date: Date; text: string; lines: SieTrans[]; row: number };
export type SieFile = {
  program: string;
  sieType: string;
  companyName: string;
  orgNumber: string;
  years: Map<number, { start: Date; end: Date }>;
  accounts: Map<number, string>;
  ib: Map<number, number>; // år 0
  ub: Map<number, number>; // år 0
  res: Map<number, number>; // år 0
  vers: SieVer[];
  warnings: string[];
};

/** Delar en rad i fält: citerade strängar, {objektlistor} och vanliga ord. */
function tokenize(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === " " || c === "\t") {
      i++;
    } else if (c === '"') {
      let s = "";
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === "\\" && i + 1 < line.length) i++;
        s += line[i++];
      }
      i++;
      out.push(s);
    } else if (c === "{") {
      const end = line.indexOf("}", i);
      out.push(line.slice(i, end === -1 ? line.length : end + 1));
      i = end === -1 ? line.length : end + 1;
    } else {
      let s = "";
      while (i < line.length && line[i] !== " " && line[i] !== "\t") s += line[i++];
      out.push(s);
    }
  }
  return out;
}

function sieDate(s: string | undefined): Date | null {
  if (!s || !/^\d{8}$/.test(s)) return null;
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
  return Number.isNaN(d.getTime()) ? null : d;
}
const sieAmount = (s: string | undefined) => {
  const n = Number(String(s ?? "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

export class SieError extends Error {}

export function parseSie(text: string): SieFile {
  const f: SieFile = {
    program: "",
    sieType: "",
    companyName: "",
    orgNumber: "",
    years: new Map(),
    accounts: new Map(),
    ib: new Map(),
    ub: new Map(),
    res: new Map(),
    vers: [],
    warnings: [],
  };
  const lines = text.split(/\r?\n/);
  let ver: SieVer | null = null;
  let inBlock = false;

  for (let row = 0; row < lines.length; row++) {
    const raw = lines[row].trim();
    if (!raw) continue;
    if (raw === "{") {
      inBlock = true;
      continue;
    }
    if (raw === "}") {
      if (ver) f.vers.push(ver);
      ver = null;
      inBlock = false;
      continue;
    }
    const t = tokenize(raw);
    const tag = t[0].toUpperCase();
    switch (tag) {
      case "#PROGRAM":
        f.program = t.slice(1).join(" ");
        break;
      case "#SIETYP":
        f.sieType = t[1] ?? "";
        break;
      case "#FNAMN":
        f.companyName = t[1] ?? "";
        break;
      case "#ORGNR":
        f.orgNumber = t[1] ?? "";
        break;
      case "#RAR": {
        const start = sieDate(t[2]);
        const end = sieDate(t[3]);
        if (start && end) f.years.set(Number(t[1]), { start, end });
        break;
      }
      case "#KONTO":
        if (/^\d{4}$/.test(t[1] ?? "")) f.accounts.set(Number(t[1]), t[2] ?? "");
        break;
      case "#IB":
      case "#UB":
      case "#RES":
        if (t[1] === "0" && /^\d{4}$/.test(t[2] ?? "")) {
          const target = tag === "#IB" ? f.ib : tag === "#UB" ? f.ub : f.res;
          target.set(Number(t[2]), (target.get(Number(t[2])) ?? 0) + sieAmount(t[3]));
        }
        break;
      case "#VER": {
        const date = sieDate(t[3]);
        if (!date) {
          f.warnings.push(`Rad ${row + 1}: verifikat utan giltigt datum hoppades över.`);
          ver = null;
          break;
        }
        const num = parseInt(t[2] ?? "", 10);
        ver = { series: t[1] || "A", number: Number.isFinite(num) ? num : null, date, text: t[4] ?? "", lines: [], row: row + 1 };
        if (raw.endsWith("{")) inBlock = true;
        break;
      }
      case "#TRANS": {
        // #RTRANS/#BTRANS (tillagda/borttagna rader) ignoreras; tillagda rader upprepas som #TRANS enligt specifikationen.
        if (!ver || !inBlock) break;
        const account = Number(t[1]);
        const amount = sieAmount(t[3]);
        if (!/^\d{4}$/.test(t[1] ?? "") || Number.isNaN(amount)) {
          f.warnings.push(`Rad ${row + 1}: ogiltig transaktionsrad hoppades över.`);
          break;
        }
        ver.lines.push({ account, amount, text: t[5] ?? "" });
        break;
      }
      default:
        break;
    }
  }
  if (!f.years.has(0)) throw new SieError("Filen saknar räkenskapsår (#RAR 0). Är det en SIE-fil av typ 4?");
  return f;
}

// ---------------------------------------------------------------- Skapande

const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ")}"`;
const d8 = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const amt = (ore: number) => (ore / 100).toFixed(2);
const ktyp = (n: number) => (n < 2000 ? "T" : n < 3000 ? "S" : n < 4000 ? "I" : "K");

export type SieExport = {
  company: { name: string; orgNumber: string; address: string; postalCode: string; city: string; phone: string; email: string };
  year: { start: Date; end: Date };
  prevYear?: { start: Date; end: Date };
  accounts: { number: number; name: string }[];
  ib: Map<number, number>;
  ub: Map<number, number>;
  res: Map<number, number>;
  prevIb?: Map<number, number>;
  prevUb?: Map<number, number>;
  prevRes?: Map<number, number>;
  vers: { series: string; number: number; date: Date; text: string; created: Date; lines: { account: number; amount: number; text: string }[] }[];
};

export function buildSie(e: SieExport): string {
  const out: string[] = [
    "#FLAGGA 0",
    `#PROGRAM ${q("Huvudbok")} 1.0`,
    "#FORMAT PC8",
    `#GEN ${d8(new Date())}`,
    "#SIETYP 4",
    `#FNAMN ${q(e.company.name)}`,
    `#ORGNR ${e.company.orgNumber}`,
    `#ADRESS ${q(e.company.email)} ${q(e.company.address)} ${q(`${e.company.postalCode} ${e.company.city}`.trim())} ${q(e.company.phone)}`,
    `#RAR 0 ${d8(e.year.start)} ${d8(e.year.end)}`,
  ];
  if (e.prevYear) out.push(`#RAR -1 ${d8(e.prevYear.start)} ${d8(e.prevYear.end)}`);
  out.push("#KPTYP BAS2014");
  for (const a of e.accounts) out.push(`#KONTO ${a.number} ${q(a.name)}`, `#KTYP ${a.number} ${ktyp(a.number)}`);
  const balances = (tag: string, year: number, m?: Map<number, number>, range: [number, number] = [1000, 2999]) => {
    if (!m) return;
    for (const [acc, v] of [...m.entries()].sort((a, b) => a[0] - b[0])) {
      if (acc >= range[0] && acc <= range[1] && v !== 0) out.push(`${tag} ${year} ${acc} ${amt(v)}`);
    }
  };
  balances("#IB", 0, e.ib);
  balances("#UB", 0, e.ub);
  balances("#IB", -1, e.prevIb);
  balances("#UB", -1, e.prevUb);
  balances("#RES", 0, e.res, [3000, 8999]);
  balances("#RES", -1, e.prevRes, [3000, 8999]);
  for (const v of e.vers) {
    out.push(`#VER ${q(v.series)} ${q(String(v.number))} ${d8(v.date)} ${q(v.text)} ${d8(v.created)}`, "{");
    for (const l of v.lines) out.push(`   #TRANS ${l.account} {} ${amt(l.amount)}${l.text ? ` "" ${q(l.text)}` : ""}`);
    out.push("}");
  }
  return out.join("\r\n") + "\r\n";
}
