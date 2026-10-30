import { db } from "./db";
import { IB_SERIES } from "./accounting";

/**
 * Konteringsförslag utifrån en beskrivning (t.ex. "Telia mobil oktober").
 * Källor, i prioritetsordning:
 *  1. Historik – hur företaget själv bokfört liknande beskrivningar (lär sig över tid).
 *  2. Bokföringsmallar – namn, kategori och sökord.
 *  3. Ordlista – vanliga leverantörer och ord kopplade till BAS-konton.
 *  4. Kontonamn – t.ex. "hyra" → 5010 Lokalhyra.
 */

export type SuggestDirection = "purchase" | "sale" | "reverse";
export type Suggestion = {
  key: string;
  source: "history" | "template" | "keyword" | "account";
  title: string;
  subtitle: string;
  account: number;
  vatRate: number;
  direction: SuggestDirection;
  /** Från historiken: kontona och deras andel av beloppet (debet positivt). */
  pattern?: { account: number; share: number }[];
  templateLines?: unknown;
  score: number;
};

type Rule = { words: string[]; account: number; vat: number; direction?: SuggestDirection; label: string };

// Ordlista med vanliga ord och leverantörer. Utländska tjänster bokförs med omvänd skattskyldighet.
const RULES: Rule[] = [
  { words: ["telefon", "mobil", "telia", "tele2", "telenor", "comviq", "hallon", "abonnemang mobil"], account: 6212, vat: 25, label: "Mobiltelefon" },
  { words: ["internet", "bredband", "fiber", "webbhotell", "hosting", "domän", "loopia", "one.com", "binero", "bahnhof"], account: 6230, vat: 25, label: "Internet och webb" },
  { words: ["programvara", "licens", "saas", "prenumeration", "fortnox", "visma", "bokio", "spotify business"], account: 5420, vat: 25, label: "Programvara" },
  { words: ["adobe", "microsoft", "office 365", "google workspace", "gsuite", "dropbox", "canva", "figma", "meta", "facebook", "linkedin"], account: 4535, vat: 25, direction: "reverse", label: "Tjänst från EU-land (omvänd moms)" },
  { words: ["chatgpt", "openai", "anthropic", "claude", "github", "aws", "amazon web services", "slack", "zoom", "notion", "vercel", "heroku", "netlify"], account: 4531, vat: 25, direction: "reverse", label: "Tjänst utanför EU (omvänd moms)" },
  { words: ["kontorsmaterial", "papper", "penna", "pennor", "toner", "bläck", "pärm", "kontor"], account: 6110, vat: 25, label: "Kontorsmaterial" },
  { words: ["dator", "laptop", "skärm", "tangentbord", "mus", "hörlurar", "webbkamera", "laddare", "kabel", "inventarie", "kontorsstol", "stol", "skrivbord", "möbler", "lampa", "hylla"], account: 5410, vat: 25, label: "Förbrukningsinventarier" },
  { words: ["förbrukningsmaterial", "material", "verktyg"], account: 5460, vat: 25, label: "Förbrukningsmaterial" },
  { words: ["lunch", "middag", "restaurang", "kundmöte", "representation", "affärsmiddag"], account: 6071, vat: 12, label: "Representation (avdragsgill)" },
  { words: ["fika", "kaffe", "personalfest", "kickoff", "julbord"], account: 7690, vat: 12, label: "Övriga personalkostnader" },
  { words: ["hotell", "logi", "boende", "airbnb", "scandic", "elite", "comfort"], account: 5831, vat: 12, label: "Hotell och logi" },
  { words: ["tåg", "sj", "flyg", "buss", "biljett", "sl ", "västtrafik", "skånetrafiken", "norwegian", "sas"], account: 5810, vat: 6, label: "Resa – biljetter" },
  { words: ["taxi", "uber", "bolt", "taxi stockholm"], account: 5800, vat: 6, label: "Resekostnader – taxi" },
  { words: ["parkering", "easypark", "parkster", "aimo"], account: 5800, vat: 25, label: "Resekostnader – parkering" },
  { words: ["bensin", "diesel", "drivmedel", "tanka", "circle k", "preem", "okq8", "st1", "ingo"], account: 5611, vat: 25, label: "Drivmedel" },
  { words: ["hyra", "lokalhyra", "kontorshyra", "coworking"], account: 5010, vat: 25, label: "Lokalhyra" },
  { words: ["städ", "städning", "rengöring"], account: 5060, vat: 25, label: "Städning" },
  { words: ["annons", "reklam", "marknadsföring", "google ads", "sponsring"], account: 5910, vat: 25, label: "Annonsering" },
  { words: ["porto", "frimärke", "postnord", "frakt", "dhl", "bring", "schenker"], account: 6250, vat: 25, label: "Porto och frakt" },
  { words: ["försäkring", "trygg-hansa", "folksam", "länsförsäkringar", "if skadeförsäkring"], account: 6310, vat: 0, label: "Företagsförsäkring" },
  { words: ["bankavgift", "bankkostnad", "kortavgift", "swish avgift", "månadsavgift bank"], account: 6570, vat: 0, label: "Bankkostnader" },
  { words: ["redovisning", "revisor", "revision", "bokföringsbyrå", "deklarationshjälp"], account: 6530, vat: 25, label: "Redovisningstjänster" },
  { words: ["konsult", "it-tjänst", "webbutveckling", "utvecklare", "support"], account: 6540, vat: 25, label: "IT-tjänster" },
  { words: ["bok", "böcker", "tidning", "tidskrift", "facklitteratur"], account: 6970, vat: 6, label: "Facklitteratur" },
  { words: ["inköp varor", "varuinköp", "handelsvaror", "grossist", "lager"], account: 4010, vat: 25, label: "Inköp av varor" },
  { words: ["ränta", "räntekostnad"], account: 8410, vat: 0, label: "Räntekostnader" },
  { words: ["försäljning", "intäkt", "kontantförsäljning", "kassa", "swishbetalning"], account: 3001, vat: 25, direction: "sale", label: "Försäljning 25 %" },
  { words: ["aktiekapital", "nyemission"], account: 2081, vat: 0, direction: "sale", label: "Insättning aktiekapital" },
  { words: ["insättning", "lån från ägare", "ägarlån", "aktieägartillskott"], account: 2893, vat: 0, direction: "sale", label: "Insättning från ägare" },
  { words: ["eget uttag", "privat uttag"], account: 2013, vat: 0, label: "Eget uttag" },
];

const STOP = new Set(["och", "för", "med", "till", "från", "the", "kr", "sek", "av", "på", "i", "en", "ett", "faktura", "kvitto", "betalning"]);
const norm = (s: string) => s.toLowerCase().normalize("NFC");
const tokens = (s: string) =>
  norm(s)
    .split(/[^a-z0-9åäöéü.-]+/i)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));

const textWords = (s: string) => norm(s).split(/[^a-z0-9åäöéü.-]+/i).filter(Boolean);

/**
 * Matchar ett sökord mot en text. Korta ord (< 5 tecken) måste börja ett ord ("kund" träffar "kundlunch" men inte
 * "exempelkunden"); längre ord får finnas inuti sammansatta ord ("lunch" träffar "kundlunch").
 */
function wordHit(word: string, text: string) {
  const w = norm(word).trim();
  if (w.includes(" ")) return norm(text).includes(w);
  return textWords(text).some((t) => t.startsWith(w) || (w.length >= 5 && t.includes(w)));
}

/** Gissar riktning och moms utifrån konto (används för kontonamnsträffar). */
function defaults(account: number): { direction: SuggestDirection; vat: number } {
  if (account >= 3000 && account < 4000) return { direction: "sale", vat: 25 };
  return { direction: "purchase", vat: account >= 4000 && account < 8000 ? 25 : 0 };
}

export async function suggest(companyId: number, q: string): Promise<Suggestion[]> {
  const text = norm(q).trim();
  const words = tokens(q);
  if (text.length < 2) return [];

  const [company, templates, accounts, history] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: companyId }, select: { vatPeriod: true } }),
    db.template.findMany({ where: { companyId } }),
    db.account.findMany({ where: { companyId, active: true }, select: { number: true, name: true } }),
    words.length
      ? db.verification.findMany({
          where: {
            companyId,
            series: { not: IB_SERIES },
            reversedById: null,
            reverses: null,
            OR: words.map((w) => ({ description: { contains: w, mode: "insensitive" as const } })),
          },
          include: { lines: true },
          orderBy: { date: "desc" },
          take: 150,
        })
      : Promise.resolve([]),
  ]);
  return rankSuggestions(q, { templates, accounts, history, noVat: company.vatPeriod === "none" });
}

type HistoryVerification = { description: string; lines: { accountNumber: number; debit: number; credit: number }[] };
type TemplateRow = { id: number; name: string; category: string; keywords: string; costAccount: number; vatRate: number; direction: string; lines?: unknown };

/** Rangordnar förslag utifrån redan hämtade data (används även av bankimporten för många rader i taget). */
export function rankSuggestions(
  q: string,
  ctx: { templates: TemplateRow[]; accounts: { number: number; name: string }[]; history: HistoryVerification[]; noVat: boolean },
): Suggestion[] {
  const text = norm(q).trim();
  const words = tokens(q);
  if (text.length < 2) return [];
  const { templates, accounts, history, noVat } = ctx;
  const name = new Map(accounts.map((a) => [a.number, a.name]));
  const out: Suggestion[] = [];

  // 1. Historik: gruppera på konteringsmönster (vilka konton på vilken sida).
  const groups = new Map<string, { count: number; overlap: number; latest: (typeof history)[number] }>();
  for (const v of history) {
    const total = v.lines.reduce((s, l) => s + l.debit, 0);
    if (!total) continue;
    const sig = v.lines
      .map((l) => `${l.accountNumber}${l.debit ? "D" : "K"}`)
      .sort()
      .join(",");
    const overlap = words.filter((w) => wordHit(w, v.description)).length / words.length;
    // Med flera sökord krävs att minst hälften träffar, så att enstaka ord inte ger irrelevanta förslag.
    if (overlap === 0 || (words.length > 1 && overlap < 0.5)) continue;
    const g = groups.get(sig);
    if (g) {
      g.count++;
      g.overlap = Math.max(g.overlap, overlap);
    } else groups.set(sig, { count: 1, overlap, latest: v });
  }
  for (const [sig, g] of groups) {
    const v = g.latest;
    const total = v.lines.reduce((s, l) => s + l.debit, 0);
    const main = [...v.lines].filter((l) => l.accountNumber >= 3000 || l.accountNumber < 1900).sort((a, b) => b.debit + b.credit - (a.debit + a.credit))[0] ?? v.lines[0];
    out.push({
      key: `h:${sig}`,
      source: "history",
      title: v.description,
      subtitle: `Som tidigare (${g.count} ggr): ${[...new Set(v.lines.map((l) => l.accountNumber))].join(" · ")}`,
      account: main.accountNumber,
      vatRate: 0,
      direction: "purchase",
      pattern: v.lines.map((l) => ({ account: l.accountNumber, share: (l.debit - l.credit) / total })),
      score: 70 + g.overlap * 50 + Math.min(g.count, 10) * 3,
    });
  }

  // 2. Bokföringsmallar
  for (const t of templates) {
    const hay = `${t.name} ${t.category} ${t.keywords}`;
    const hits = words.filter((w) => wordHit(w, hay)).length;
    if (!hits) continue;
    out.push({
      key: `t:${t.id}`,
      source: "template",
      title: t.name,
      subtitle: `Mall · ${t.costAccount} ${name.get(t.costAccount) ?? ""} · ${noVat ? "ingen moms" : `${t.vatRate} % moms`}`,
      account: t.costAccount,
      vatRate: noVat ? 0 : t.vatRate,
      direction: (noVat && t.direction === "reverse" ? "purchase" : t.direction) as SuggestDirection,
      templateLines: t.lines,
      score: 60 + hits * 10,
    });
  }

  // 3. Ordlista
  for (const r of RULES) {
    // Ordlistans ord ska börja ett ord i beskrivningen ("hotell" träffar "hotellnatt" men inte "webbhotell").
    const matched = r.words.filter((w) => (w.includes(" ") ? text.includes(w.trim()) : textWords(text).some((t) => t.startsWith(w.trim()))));
    const hits = matched.length;
    if (!hits || !name.has(r.account)) continue;
    const specificity = Math.max(...matched.map((w) => w.length));
    const vat = noVat ? 0 : r.vat;
    out.push({
      key: `k:${r.account}:${r.direction ?? "p"}`,
      source: "keyword",
      title: r.label,
      subtitle: `${r.account} ${name.get(r.account)} · ${r.direction === "reverse" && !noVat ? "omvänd moms 25 %" : vat ? `${vat} % moms` : "ingen moms"}`,
      account: r.account,
      vatRate: vat,
      direction: noVat && r.direction === "reverse" ? "purchase" : (r.direction ?? "purchase"),
      score: 50 + hits * 8 + specificity,
    });
  }

  // 4. Kontonamn (och kontonummer)
  for (const a of accounts) {
    const byNumber = /^\d{2,4}$/.test(text) && String(a.number).startsWith(text);
    const hits = words.filter((w) => wordHit(w, a.name)).length;
    if (!hits && !byNumber) continue;
    // Namnsökning bara bland intäkts- och kostnadskonton (balanskonton som "Kundfordringar" ger fel träffar); nummer går alltid.
    if (!byNumber && a.number < 3000) continue;
    if (a.number >= 1900 && a.number < 2000) continue; // bank/kassa är motkontot, inte förslaget
    const d = defaults(a.number);
    const vat = noVat ? 0 : d.vat;
    out.push({
      key: `a:${a.number}`,
      source: "account",
      title: `${a.number} ${a.name}`,
      subtitle: vat ? `${vat} % moms` : "ingen moms",
      account: a.number,
      vatRate: vat,
      direction: d.direction,
      score: 30 + hits * 6 + (byNumber ? 5 : 0),
    });
  }

  // Bästa förslaget per konto; historik vinner över mallar, mallar över ordlista osv.
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.score - a.score)
    .filter((s) => {
      const k = s.source === "history" ? s.key : `${s.account}:${s.direction}`;
      if (seen.has(k) || (s.source !== "history" && seen.has(`${s.account}:${s.direction}`))) return false;
      seen.add(k);
      seen.add(`${s.account}:${s.direction}`);
      return true;
    })
    .slice(0, 6);
}
