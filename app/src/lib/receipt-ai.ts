import "server-only";

/**
 * Avläsning av kvitton och fakturor med AI via OpenRouter (https://openrouter.ai).
 * Standardmodell: google/gemini-3.1-flash-lite – billig, bra på text i bilder och läser PDF direkt.
 * Reserv om den inte svarar: google/gemini-2.5-flash-lite. Båda kan ändras med OPENROUTER_MODEL.
 */
export const AI_MODEL = process.env.OPENROUTER_MODEL || "google/gemini-3.1-flash-lite";
const FALLBACK_MODEL = "google/gemini-2.5-flash-lite";
// OPENROUTER_BASE_URL kan peka på en proxy eller en lokal testserver.
const ENDPOINT = `${(process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "")}/chat/completions`;

export const aiEnabled = () => !!process.env.OPENROUTER_API_KEY;

/** Höjs när avläsningen förbättras, så att sparade avläsningar från en äldre version görs om. */
export const AI_VERSION = 2;

export type ReceiptData = {
  supplier: string | null;
  supplierOrgNumber: string | null;
  documentType: "receipt" | "invoice" | "other";
  date: string | null; // ÅÅÅÅ-MM-DD
  dueDate: string | null;
  total: number | null; // inkl. moms, i dokumentets valuta
  currency: string;
  vat: { rate: number; amount: number }[];
  country: "SE" | "EU" | "OUTSIDE_EU";
  description: string;
  templateId: number | null;
  confidence: number;
  version?: number;
};

export class ReceiptAiError extends Error {}

type TemplateInfo = { id: number; name: string; description: string };

function schema(templates: TemplateInfo[]) {
  return {
  type: "object",
  additionalProperties: false,
  required: ["supplier", "supplierOrgNumber", "documentType", "date", "dueDate", "total", "currency", "vat", "country", "description", "templateId", "confidence"],
  properties: {
    supplier: { type: ["string", "null"], description: "Säljarens/leverantörens namn" },
    supplierOrgNumber: { type: ["string", "null"], description: "Säljarens organisationsnummer eller momsregistreringsnummer om det står" },
    documentType: { type: "string", enum: ["receipt", "invoice", "other"] },
    date: { type: ["string", "null"], description: "Köp-/fakturadatum, ÅÅÅÅ-MM-DD" },
    dueDate: { type: ["string", "null"], description: "Förfallodatum för fakturor, ÅÅÅÅ-MM-DD" },
    total: { type: ["number", "null"], description: "Totalt belopp att betala inklusive moms" },
    currency: { type: "string", description: "Valutakod, t.ex. SEK, EUR, USD" },
    vat: {
      type: "array",
      description: "Moms per momssats enligt dokumentet",
      items: { type: "object", additionalProperties: false, required: ["rate", "amount"], properties: { rate: { type: "number" }, amount: { type: "number" } } },
    },
    country: { type: "string", enum: ["SE", "EU", "OUTSIDE_EU"], description: "Säljarens land: Sverige, annat EU-land eller utanför EU" },
    description: { type: "string", description: "Kort beskrivning på svenska av vad som köpts, högst 60 tecken" },
    // Måste vara en av mallarna, så att guiden alltid kan gå direkt till beloppet.
    templateId: templates.length
      ? { type: "integer", enum: templates.map((t) => t.id), description: "Id för den bokföringsmall som passar bäst" }
      : { type: "null" },
    confidence: { type: "number", description: "Hur säker avläsningen är, 0–1" },
  },
  };
}

function prompt(templates: TemplateInfo[]) {
  return [
    "Du läser av svenska och utländska kvitton och leverantörsfakturor för bokföring i ett svenskt företag.",
    "Underlaget är ett inköp som företaget gjort. Svara bara med data enligt JSON-schemat. Gissa inte: sätt null om en uppgift inte går att läsa (gäller inte templateId).",
    "Belopp anges som tal med punkt som decimaltecken (t.ex. 1249.50), totalen inklusive moms.",
    "Om momsen inte står uttryckligen men det är ett svenskt kvitto, beräkna den inte – lämna vat tom.",
    "country: SE om säljaren är svensk, EU om säljaren finns i ett annat EU-land (t.ex. Irland för Google/Meta/Adobe/Microsoft), OUTSIDE_EU annars (t.ex. USA).",
    "description: vad som köpts, på svenska och generellt (t.ex. 'Pärlor och pyssel', 'Kontorsstol', 'Lunch') – inte bara produktnamnet.",
    "templateId: välj ALLTID den mall som bäst beskriver vilken sorts kostnad det är. Utgå från vad som köpts, inte från produktens eller butikens namn.",
    "Tumregler: varor och prylar som används i verksamheten (inredning, elektronik, verktyg, möbler, pyssel- och hantverksmaterial) är förbrukningsinventarier eller förbrukningsmaterial;",
    "varor som säljs vidare är inköp av varor; mat och dryck med kunder är representation; resor, hotell, drivmedel, programvara, telefoni och tjänster har egna mallar.",
    "Mallar (id: namn – beskrivning):",
    ...templates.map((t) => `${t.id}: ${t.name}${t.description ? ` – ${t.description}` : ""}`),
  ].join("\n");
}

/** Läser av ett kvitto (bild eller PDF) och returnerar strukturerad data. */
export async function readReceipt(file: { bytes: Uint8Array; mime: string; name: string }, templates: TemplateInfo[]): Promise<ReceiptData> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new ReceiptAiError("AI-avläsning är inte aktiverad (OPENROUTER_API_KEY saknas).");
  const dataUrl = `data:${file.mime};base64,${Buffer.from(file.bytes).toString("base64")}`;
  // Mejl utan bilaga sparas som text (kvittot står i själva mejlet).
  const attachment =
    file.mime === "text/plain"
      ? { type: "text", text: `Kvittot (från ett e-postmeddelande):\n\n${Buffer.from(file.bytes).toString("utf8").slice(0, 20_000)}` }
      : file.mime === "application/pdf"
        ? { type: "file", file: { filename: file.name || "kvitto.pdf", file_data: dataUrl } }
        : { type: "image_url", image_url: { url: dataUrl } };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "https://huvudbok.app",
      "X-Title": "Huvudbok",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      models: AI_MODEL === FALLBACK_MODEL ? undefined : [AI_MODEL, FALLBACK_MODEL],
      // Bara leverantörer som stödjer strukturerad utdata.
      provider: { require_parameters: true },
      temperature: 0,
      max_tokens: 1200,
      response_format: { type: "json_schema", json_schema: { name: "receipt", strict: true, schema: schema(templates) } },
      messages: [
        { role: "system", content: prompt(templates) },
        { role: "user", content: [{ type: "text", text: "Läs av det här underlaget." }, attachment] },
      ],
    }),
    signal: AbortSignal.timeout(55_000),
  }).catch((e: Error) => {
    throw new ReceiptAiError(e.name === "TimeoutError" ? "AI-tjänsten svarade inte i tid." : "Kunde inte nå AI-tjänsten.");
  });

  const json = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } } | null;
  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new ReceiptAiError("OpenRouter nekade nyckeln (OPENROUTER_API_KEY). Kontrollera den.");
    if (res.status === 402) throw new ReceiptAiError("OpenRouter-kontot saknar krediter.");
    throw new ReceiptAiError(`AI-avläsningen misslyckades: ${msg}`);
  }
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new ReceiptAiError("AI-tjänsten returnerade inget svar.");
  return normalize(JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")), templates);
}

const isoDate = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null);
const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : null);

/** Kontrollerar och städar modellens svar (lita aldrig blint på det). */
export function normalize(raw: Record<string, unknown>, templates: { id: number }[]): ReceiptData {
  const vat = Array.isArray(raw.vat)
    ? (raw.vat as { rate: unknown; amount: unknown }[]).flatMap((v) => (num(v?.rate) !== null && num(v?.amount) !== null ? [{ rate: num(v.rate)!, amount: num(v.amount)! }] : []))
    : [];
  const templateId = typeof raw.templateId === "number" && templates.some((t) => t.id === raw.templateId) ? raw.templateId : null;
  const country = raw.country === "EU" || raw.country === "OUTSIDE_EU" ? raw.country : "SE";
  const doc = raw.documentType === "invoice" || raw.documentType === "other" ? raw.documentType : "receipt";
  const total = num(raw.total);
  return {
    supplier: typeof raw.supplier === "string" && raw.supplier.trim() ? raw.supplier.trim().slice(0, 120) : null,
    supplierOrgNumber: typeof raw.supplierOrgNumber === "string" && raw.supplierOrgNumber.trim() ? raw.supplierOrgNumber.trim().slice(0, 40) : null,
    documentType: doc,
    date: isoDate(raw.date),
    dueDate: isoDate(raw.dueDate),
    total: total !== null && total > 0 ? Math.round(total * 100) / 100 : null,
    currency: typeof raw.currency === "string" && /^[A-Z]{3}$/i.test(raw.currency.trim()) ? raw.currency.trim().toUpperCase() : "SEK",
    vat,
    country,
    description: typeof raw.description === "string" ? raw.description.trim().slice(0, 80) : "",
    templateId,
    confidence: Math.min(1, Math.max(0, num(raw.confidence) ?? 0)),
    version: AI_VERSION,
  };
}
