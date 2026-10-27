// Regler för fakturor: belopp, moms, momshantering och validering före utfärdande.
// Ren modul (ingen databas) som används både i webbläsaren (fakturaformuläret) och på servern (utfärdande, PDF).
//
// Lagstöd (sammanfattat):
//  - Mervärdesskattelagen (2023:200) 17 kap. 24 §: innehåll i en fullständig faktura, bl.a. datum, unikt löpnummer,
//    säljarens momsregistreringsnummer, köparens momsregistreringsnummer vid omvänd betalningsskyldighet och
//    unionsintern leverans, säljarens och köparens namn och adress, varornas/tjänsternas mängd och art,
//    leverans-/tillhandahållandedatum (om det skiljer sig från fakturadatum), beskattningsunderlag per skattesats,
//    à-pris exkl. moms, rabatter, skattesats, momsbelopp och hänvisning vid undantag eller omvänd betalningsskyldighet.
//  - 17 kap. 26–28 §§: förenklad faktura, bl.a. när totalbeloppet är högst 4 000 kr inkl. moms.
//  - Aktiebolagslagen 28 kap. 5 §: aktiebolagets fakturor ska ange firma, styrelsens säte och organisationsnummer.
//  - Räntelagen 6 §: dröjsmålsränta = referensräntan + 8 procentenheter, om inget annat avtalats.
//  - Lagen (1981:739) om ersättning för inkassokostnader: påminnelseavgift högst 60 kr och bara om den avtalats i förväg.

export type VatTreatment = "standard" | "reverse_domestic" | "eu" | "export" | "exempt";

export type RulesLine = {
  description: string;
  quantity: number;
  unitPrice: number; // öre exkl. moms
  vatRate: number;
  discountBp?: number; // rabatt i hundradels procent
  type?: string; // service | goods
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
};

export const VAT_RATES = [25, 12, 6, 0] as const;

/** Avrundning till hela ören, symmetrisk kring noll så att en kreditfaktura blir exakt originalet med omvänt tecken. */
export const roundOre = (x: number) => Math.sign(x) * Math.round(Math.abs(x));

/** Radbelopp exkl. moms före rabatt, i öre. */
export const lineGross = (l: Pick<RulesLine, "quantity" | "unitPrice">) => roundOre(l.quantity * l.unitPrice);

/** Radbelopp exkl. moms efter rabatt, i öre (heltal, avrundat per rad). */
export function lineNet(l: Pick<RulesLine, "quantity" | "unitPrice" | "discountBp">) {
  const bp = Math.min(10000, Math.max(0, l.discountBp ?? 0));
  return roundOre((l.quantity * l.unitPrice * (10000 - bp)) / 10000);
}

/** Summering per momssats. Momsen räknas på summan per sats och avrundas till hela ören. */
export function invoiceTotals(lines: Pick<RulesLine, "quantity" | "unitPrice" | "vatRate" | "discountBp">[]) {
  const byRate = new Map<number, { net: number; vat: number }>();
  let gross = 0;
  for (const l of lines) {
    const net = lineNet(l);
    gross += lineGross(l);
    const cur = byRate.get(l.vatRate) ?? { net: 0, vat: 0 };
    cur.net += net;
    byRate.set(l.vatRate, cur);
  }
  for (const [rate, v] of byRate) v.vat = roundOre((v.net * rate) / 100);
  const net = [...byRate.values()].reduce((s, v) => s + v.net, 0);
  const vat = [...byRate.values()].reduce((s, v) => s + v.vat, 0);
  return { byRate, net, vat, total: net + vat, discount: gross - net };
}

// ---------- Momshantering ----------

export const VAT_TREATMENTS: Record<VatTreatment, { label: string; hint: string; zeroVat: boolean; buyerVat: boolean }> = {
  standard: { label: "Försäljning i Sverige med moms", hint: "25, 12 eller 6 % moms. Rader med 0 % kräver en hänvisning till varför moms inte tas ut.", zeroVat: false, buyerVat: false },
  reverse_domestic: {
    label: "Omvänd betalningsskyldighet i Sverige",
    hint: "T.ex. byggtjänster till ett byggföretag. Köparen redovisar momsen; köparens momsregistreringsnummer krävs.",
    zeroVat: true,
    buyerVat: true,
  },
  eu: { label: "Försäljning till företag i annat EU-land", hint: "Ingen svensk moms. Köparens momsregistreringsnummer krävs.", zeroVat: true, buyerVat: true },
  export: { label: "Export utanför EU", hint: "Ingen svensk moms.", zeroVat: true, buyerVat: false },
  exempt: { label: "Momsfri försäljning (undantag)", hint: "T.ex. vård, utbildning eller finansiella tjänster. Ange vilket undantag som gäller.", zeroVat: true, buyerVat: false },
};

export const isVatTreatment = (s: string): s is VatTreatment => s in VAT_TREATMENTS;

/** Förslag på fakturatext (hänvisning) för momshanteringen. Användaren kan ändra texten. */
export function suggestedVatNote(treatment: VatTreatment, lines: Pick<RulesLine, "type">[] = []): string {
  const goods = lines.some((l) => l.type === "goods");
  const services = lines.some((l) => l.type !== "goods");
  switch (treatment) {
    case "reverse_domestic":
      return "Omvänd betalningsskyldighet";
    case "eu":
      return [
        goods ? "Unionsintern leverans av varor, undantagen från skatteplikt (artikel 138 i mervärdesskattedirektivet)." : "",
        services || !goods ? "Omvänd betalningsskyldighet (artikel 196 i mervärdesskattedirektivet)." : "",
      ]
        .filter(Boolean)
        .join(" ");
    case "export":
      return "Export, undantagen från skatteplikt.";
    case "exempt":
      return "Undantagen från skatteplikt enligt 10 kap. mervärdesskattelagen.";
    default:
      return "";
  }
}

/** Intäktskonto (BAS) för en fakturarad beroende på momshantering, momssats och om det är vara eller tjänst. */
export function salesAccount(treatment: VatTreatment, line: Pick<RulesLine, "vatRate" | "type">): number {
  const goods = line.type === "goods";
  switch (treatment) {
    case "reverse_domestic":
      return 3231;
    case "eu":
      return goods ? 3108 : 3308;
    case "export":
      return goods ? 3105 : 3305;
    case "exempt":
      return 3004;
    default:
      return ({ 25: 3001, 12: 3002, 6: 3003 } as Record<number, number>)[line.vatRate] ?? 3004;
  }
}

// ---------- Identitetsnummer ----------

const digits = (s: string) => s.replace(/\D/g, "");

/** Kontrollsiffra (Luhn) för de tio sista siffrorna i ett organisations- eller personnummer. */
export function validOrgNumber(s: string) {
  const d = digits(s);
  const ten = d.length === 12 ? d.slice(2) : d;
  if (ten.length !== 10 || (d.length === 12 && !/^(16|18|19|20)/.test(d))) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let n = Number(ten[i]) * (i % 2 === 0 ? 2 : 1);
    if (n > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
}

/** Juridisk person (tredje siffran ≥ 2), till skillnad från ett personnummer (enskild firma eller privatperson). */
export function isOrganisationNumber(s: string) {
  const d = digits(s);
  const ten = d.length === 12 ? d.slice(2) : d;
  return ten.length === 10 && Number(ten[2]) >= 2;
}

/** Svenskt momsregistreringsnummer: SE + organisations-/personnummer (10 siffror) + 01. */
export function validSwedishVatNumber(s: string) {
  const v = s.replace(/[\s-]/g, "").toUpperCase();
  return /^SE\d{10}01$/.test(v) && validOrgNumber(v.slice(2, 12));
}

/** Formatkontroll för momsregistreringsnummer i EU (landskod + 2–13 tecken). Säger inget om att numret finns. */
export function validVatNumberFormat(s: string) {
  const v = s.replace(/[\s.-]/g, "").toUpperCase();
  if (v.startsWith("SE")) return validSwedishVatNumber(v);
  return /^(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SI|SK|XI)[0-9A-Z+*]{2,13}$/.test(v);
}

/** Momsregistreringsnumret ska innehålla samma 10 siffror som organisationsnumret. */
export function vatMatchesOrg(vat: string, org: string) {
  const v = vat.replace(/[\s-]/g, "").toUpperCase();
  const o = digits(org);
  return v.slice(2, 12) === (o.length === 12 ? o.slice(2) : o);
}

export const formatVatNumber = (s: string) => s.replace(/[\s.-]/g, "").toUpperCase();

// ---------- Texter för betalningsvillkor ----------

export function lateInterestText(rate: number | null | undefined) {
  return rate == null
    ? "Vid betalning efter förfallodagen debiteras dröjsmålsränta enligt räntelagen."
    : `Vid betalning efter förfallodagen debiteras dröjsmålsränta med ${rate.toLocaleString("sv-SE")} % per år.`;
}

export const MAX_REMINDER_FEE = 6000; // öre (60 kr), lagen om ersättning för inkassokostnader

export function reminderFeeText(fee: number) {
  return fee > 0 ? `Vid påminnelse debiteras en påminnelseavgift på ${(fee / 100).toLocaleString("sv-SE")} kr enligt avtal.` : "";
}

/** Swish-QR för förifylld betalning: C<nummer>;<belopp>;<meddelande>;<redigerbart> där 0 = inget kan ändras. */
export function swishPayload(number: string, totalOre: number, message: string) {
  const msg = message.replace(/[;\n\r]/g, " ").slice(0, 50);
  return `C${digits(number)};${(totalOre / 100).toFixed(2)};${msg};0`;
}

// ---------- Validering före utfärdande ----------

export type InvoiceIssue = { field: string; message: string; severity: "error" | "warning" };

export type ValidationInput = {
  kind?: "invoice" | "credit";
  seller: {
    name: string;
    orgNumber: string;
    vatNumber: string;
    address: string;
    postalCode: string;
    city: string;
    companyType: string; // ab | ef | hb | ek
    seat: string;
    vatRegistered: boolean;
    bankgiro: string;
    plusgiro: string;
    bankAccount?: string; // valfritt så att befintliga anrop fortsätter kompilera
    iban: string;
    swishNumber: string;
  };
  buyer: { name: string; orgNumber: string; vatNumber: string; address: string; postalCode: string; city: string; country: string } | null;
  invoice: { date: string; dueDate: string; deliveryDate?: string | null; vatTreatment: VatTreatment; vatNote: string; simplified: boolean };
  lines: RulesLine[];
};

export const SIMPLIFIED_LIMIT = 400_000; // öre (4 000 kr inkl. moms)

const isDate = (s: string | null | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const day = (d: Date | string | null | undefined) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d ?? ""));

/**
 * Kontrollerar en faktura innan den utfärdas. Fel (error) stoppar utfärdandet; varningar (warning) visas men stoppar inte.
 * Kontrollerar format, inte att organisations- eller momsnummer faktiskt finns registrerade.
 */
export function validateInvoice(input: ValidationInput): InvoiceIssue[] {
  const out: InvoiceIssue[] = [];
  const err = (field: string, message: string) => out.push({ field, message, severity: "error" });
  const warn = (field: string, message: string) => out.push({ field, message, severity: "warning" });
  const { seller: s, buyer: b, invoice: inv } = input;
  const credit = input.kind === "credit";
  const t = VAT_TREATMENTS[inv.vatTreatment] ?? VAT_TREATMENTS.standard;

  // Säljaren (företagsinställningar)
  if (!s.name.trim()) err("seller.name", "Företagets registrerade namn saknas (Inställningar → Företag).");
  if (!validOrgNumber(s.orgNumber)) err("seller.orgNumber", "Företagets organisationsnummer saknas eller är ogiltigt.");
  if (!inv.simplified && (!s.address.trim() || !s.postalCode.trim() || !s.city.trim())) err("seller.address", "Företagets adress, postnummer och ort krävs på fakturan.");
  if (s.vatRegistered) {
    if (!s.vatNumber.trim()) err("seller.vatNumber", "Företagets momsregistreringsnummer saknas (Inställningar → Företag).");
    else if (!validSwedishVatNumber(s.vatNumber)) err("seller.vatNumber", "Företagets momsregistreringsnummer har fel format (SE + 10 siffror + 01).");
    else if (!vatMatchesOrg(s.vatNumber, s.orgNumber)) err("seller.vatNumber", "Momsregistreringsnumret stämmer inte med organisationsnumret.");
  }
  if (s.companyType === "ab" && !s.seat.trim()) err("seller.seat", "Aktiebolag ska ange styrelsens säte (kommun) på fakturan (Inställningar → Företag).");
  if (!credit && !s.bankgiro.trim() && !s.plusgiro.trim() && !(s.bankAccount ?? "").trim() && !s.iban.trim() && !s.swishNumber.trim()) {
    err("seller.payment", "Ange minst ett sätt att betala: bankgiro, plusgiro, bankkonto, IBAN eller Swish (Fakturadesign).");
  }

  // Köparen
  if (!b || !b.name.trim()) err("customer", "Välj en kund.");
  else {
    if (!inv.simplified && (!b.address.trim() || !b.postalCode.trim() || !b.city.trim())) err("customer.address", `Kundens adress, postnummer och ort saknas (${b.name}).`);
    const org = b.orgNumber.trim();
    if (org && /^[\d\s-]+$/.test(org) && !validOrgNumber(org)) err("customer.orgNumber", `Kundens organisations-/personnummer är ogiltigt (${org}).`);
    if (t.buyerVat) {
      if (!b.vatNumber.trim()) err("customer.vatNumber", "Kundens momsregistreringsnummer krävs för den här momshanteringen.");
      else if (!validVatNumberFormat(b.vatNumber)) err("customer.vatNumber", `Kundens momsregistreringsnummer har fel format (${b.vatNumber}).`);
    } else if (b.vatNumber.trim() && !validVatNumberFormat(b.vatNumber)) warn("customer.vatNumber", `Kundens momsregistreringsnummer ser ut att ha fel format (${b.vatNumber}).`);
    if (inv.vatTreatment === "eu" && (b.country || "SE").toUpperCase() === "SE") err("customer.country", "Försäljning till annat EU-land kräver att kunden har ett annat land än Sverige.");
    if (inv.vatTreatment === "export" && (b.country || "SE").toUpperCase() === "SE") warn("customer.country", "Export: kunden har Sverige som land.");
  }

  // Datum
  if (!isDate(inv.date)) err("date", "Ange fakturadatum.");
  if (!isDate(inv.dueDate)) err("dueDate", "Ange förfallodatum.");
  if (isDate(inv.date) && isDate(inv.dueDate) && inv.dueDate < inv.date) err("dueDate", "Förfallodatum kan inte vara före fakturadatum.");
  if (inv.deliveryDate && !isDate(inv.deliveryDate)) err("deliveryDate", "Leveransdatum har fel format.");

  // Rader
  const lines = input.lines.filter((l) => l.description.trim() || l.unitPrice);
  if (lines.length === 0) err("lines", "Fakturan måste ha minst en rad.");
  lines.forEach((l, i) => {
    const n = `Rad ${i + 1}`;
    if (!l.description.trim()) err(`lines.${i}.description`, `${n}: beskrivning saknas.`);
    if (!Number.isFinite(l.quantity) || l.quantity === 0) err(`lines.${i}.quantity`, `${n}: antal saknas.`);
    if (!Number.isInteger(l.unitPrice)) err(`lines.${i}.unitPrice`, `${n}: ogiltigt pris.`);
    if (!(VAT_RATES as readonly number[]).includes(l.vatRate)) err(`lines.${i}.vatRate`, `${n}: ogiltig momssats.`);
    if ((l.discountBp ?? 0) < 0 || (l.discountBp ?? 0) > 10000) err(`lines.${i}.discount`, `${n}: rabatten måste vara 0–100 %.`);
    const ps = day(l.periodStart);
    const pe = day(l.periodEnd);
    if ((ps && !isDate(ps)) || (pe && !isDate(pe))) err(`lines.${i}.period`, `${n}: perioden har fel datumformat.`);
    if (ps && pe && pe < ps) err(`lines.${i}.period`, `${n}: periodens slut är före start.`);
    if ((ps && !pe) || (!ps && pe)) warn(`lines.${i}.period`, `${n}: ange både start och slut för perioden.`);
  });

  // Moms
  const zeroLines = lines.filter((l) => l.vatRate === 0);
  if (!s.vatRegistered && lines.some((l) => l.vatRate > 0)) err("vat", "Företaget är inte momsregistrerat och får inte debitera moms. Sätt 0 % på alla rader.");
  if (s.vatRegistered && t.zeroVat && lines.some((l) => l.vatRate > 0)) err("vat", `${t.label}: alla rader ska ha 0 % moms.`);
  if (s.vatRegistered && (t.zeroVat || zeroLines.length > 0) && !inv.vatNote.trim()) {
    err("vatNote", t.zeroVat ? `${t.label}: ange fakturatexten (hänvisning), t.ex. "${suggestedVatNote(inv.vatTreatment, lines)}".` : "Rader med 0 % moms kräver en hänvisning till varför moms inte tas ut.");
  }
  if (!s.vatRegistered && inv.vatTreatment !== "standard") err("vatTreatment", "Särskild momshantering kräver att företaget är momsregistrerat.");

  // Belopp
  const totals = invoiceTotals(lines);
  if (lines.length && !credit && totals.total <= 0) err("total", "Fakturans totalbelopp måste vara större än noll.");
  if (inv.simplified) {
    if (Math.abs(totals.total) > SIMPLIFIED_LIMIT) err("simplified", "Förenklad faktura får användas bara om totalbeloppet är högst 4 000 kr inkl. moms.");
    if (inv.vatTreatment === "eu") err("simplified", "Förenklad faktura kan inte användas vid försäljning till annat EU-land.");
  }
  return out;
}

export const blocking = (issues: InvoiceIssue[]) => issues.filter((i) => i.severity === "error");
