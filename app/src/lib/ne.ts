/**
 * Underlag för NE-bilagan (enskild firma): kopplar BAS-konton till fälten R1–R11 i räkenskapsschemat (resultaträkningen).
 *
 * Kopplingen bygger på BAS-föreningens kopplingsschema för NE (bas.se, "Förenklat årsbokslut K1") och Skatteverkets broschyr
 * "Bokföring, bokslut och deklaration" (SKV 283). Den ska kontrolleras mot blanketten för aktuellt inkomstår. Alla konton kan
 * kopplas om för det enskilda företaget (se NeMapping).
 */

export const NE_FIELDS = [
  { code: "R1", name: "Försäljning och utfört arbete samt övriga momspliktiga intäkter", kind: "income" },
  { code: "R2", name: "Momsfria intäkter", kind: "income" },
  { code: "R3", name: "Bil- och bostadsförmån m.m.", kind: "income" },
  { code: "R4", name: "Ränteintäkter m.m.", kind: "income" },
  { code: "R5", name: "Varor, material och tjänster", kind: "cost" },
  { code: "R6", name: "Övriga externa kostnader", kind: "cost" },
  { code: "R7", name: "Anställd personal", kind: "cost" },
  { code: "R8", name: "Räntekostnader m.m.", kind: "cost" },
  { code: "R9", name: "Avskrivningar och nedskrivningar byggnader och markanläggningar", kind: "cost" },
  { code: "R10", name: "Avskrivningar och nedskrivningar maskiner och inventarier och immateriella tillgångar", kind: "cost" },
] as const;

export type NeField = (typeof NE_FIELDS)[number]["code"];
export const NE_CODES = NE_FIELDS.map((f) => f.code) as NeField[];
/** Värde för ett konto som medvetet inte ska ingå. */
export const NE_NONE = "none";
export type NeChoice = NeField | typeof NE_NONE;

const kindOf = (f: NeField) => NE_FIELDS.find((x) => x.code === f)!.kind;

/** Intervallet av konton som kan ingå i räkenskapsschemats resultaträkning. Kontona 8800–8999 (bokslutsdispositioner, skatt, årets resultat) ingår inte. */
export const NE_FROM = 3000;
export const NE_TO = 8799;

export type DefaultMapping = { field: NeField | null; note?: string };

/** Standardkopplingen för ett konto. `vatCode` är kontots momskod ("0" = momsfri försäljning). */
export function defaultField(account: number, vatCode = ""): DefaultMapping {
  const a = account;
  // 3 Intäkter
  if (a >= 3000 && a <= 3099) return { field: vatCode === "0" || a === 3004 ? "R2" : "R1" };
  if (a >= 3100 && a <= 3399) return { field: "R2", note: "Försäljning utanför Sverige, omvänd skattskyldighet eller VMB är normalt momsfri för säljaren." };
  if (a >= 3400 && a <= 3699) return { field: "R1" };
  if (a >= 3700 && a <= 3969) return { field: "R1", note: "Hör till R2 om intäkten gäller momsfri försäljning." };
  if (a === 3970 || a === 3980) return { field: "R2" };
  if (a >= 3900 && a <= 3999) return { field: "R1", note: "Hör till R2 om intäkten är momsfri." };
  // 4–7 Kostnader
  if (a >= 4000 && a <= 4999) return { field: "R5" };
  if (a >= 5000 && a <= 6999) return { field: "R6" };
  if (a >= 7000 && a <= 7699) return { field: "R7" };
  if (a >= 7700 && a <= 7799) return { field: "R10", note: "Nedskrivningar kan höra till R9 (byggnader och markanläggningar)." };
  if (a >= 7800 && a <= 7819) return { field: "R10" };
  if (a >= 7820 && a <= 7829) return { field: "R9" };
  if (a >= 7830 && a <= 7899) return { field: "R10" };
  // 8 Finansiellt
  if (a >= 8300 && a <= 8399) return { field: "R4" };
  if (a >= 8400 && a <= 8499) return { field: "R8" };
  return { field: null };
}

export type NeAccountRow = {
  number: number;
  name: string;
  /** Beloppet i öre, med tecknet så att intäkter och kostnader är positiva i sitt fält. */
  amount: number;
  field: NeField | null;
  source: "default" | "override" | "none";
  note?: string;
};

export type NeResult = {
  /** Belopp per fält i hela kronor (avrundat per fält, som blanketten kräver). */
  fields: Record<NeField, { kr: number; accounts: NeAccountRow[] }>;
  /** Konton med saldo som inte kopplats till något fält. */
  unmapped: NeAccountRow[];
  /** Konton som medvetet har lämnats utanför. */
  excluded: NeAccountRow[];
  /** R1+R2+R3+R4−R5−R6−R7−R8−R9−R10 (hela kronor). */
  result: number;
  /** Bokfört resultat enligt kontona 3000–8799 (hela kronor), för avstämning. */
  booked: number;
};

/**
 * @param bal saldon per konto i öre (debet − kredit)
 * @param accounts kontonamn och momskoder
 * @param overrides företagets egna kopplingar
 */
export function computeNe(bal: Map<number, number>, accounts: Map<number, { name: string; vatCode: string }>, overrides: Map<number, NeChoice>): NeResult {
  const fields = Object.fromEntries(NE_CODES.map((c) => [c, { kr: 0, accounts: [] as NeAccountRow[] }])) as NeResult["fields"];
  const unmapped: NeAccountRow[] = [];
  const excluded: NeAccountRow[] = [];
  let bookedOre = 0;

  for (const [number, balance] of [...bal].sort((x, y) => x[0] - y[0])) {
    if (number < NE_FROM || number > NE_TO || balance === 0) continue;
    bookedOre += -balance;
    const info = accounts.get(number);
    const name = info?.name ?? `Konto ${number}`;
    const override = overrides.get(number);
    if (override === NE_NONE) {
      excluded.push({ number, name, amount: -balance, field: null, source: "none" });
      continue;
    }
    const d = override ? { field: override as NeField, note: undefined } : defaultField(number, info?.vatCode ?? "");
    if (!d.field) {
      unmapped.push({ number, name, amount: -balance, field: null, source: "default" });
      continue;
    }
    // Intäkter: kredit − debet. Kostnader: debet − kredit.
    const amount = kindOf(d.field) === "income" ? -balance : balance;
    fields[d.field].accounts.push({ number, name, amount, field: d.field, source: override ? "override" : "default", note: d.note });
  }

  for (const c of NE_CODES) fields[c].kr = Math.round(fields[c].accounts.reduce((s, a) => s + a.amount, 0) / 100);
  const k = (c: NeField) => fields[c].kr;
  const result = k("R1") + k("R2") + k("R3") + k("R4") - k("R5") - k("R6") - k("R7") - k("R8") - k("R9") - k("R10");
  return { fields, unmapped, excluded, result, booked: Math.round(bookedOre / 100) };
}
