// Delas mellan server (PDF-generering) och klient (designverktyget).

export const INVOICE_TEMPLATES = [
  { key: "modern", label: "Modern", description: "Färgat sidhuvud och tydliga block" },
  { key: "klassisk", label: "Klassisk", description: "Tidlös layout med färgad accentlinje" },
  { key: "minimal", label: "Minimal", description: "Luftig, svartvit med en accentdetalj" },
  { key: "elegant", label: "Elegant", description: "Serifrubriker och färgad sidokant" },
] as const;

export type InvoiceTemplate = (typeof INVOICE_TEMPLATES)[number]["key"];

export const COLOR_PRESETS = [
  { name: "Blå", hex: "#0071e3" },
  { name: "Grafit", hex: "#1d1d1f" },
  { name: "Indigo", hex: "#4f46e5" },
  { name: "Lila", hex: "#8e44ad" },
  { name: "Rosa", hex: "#d6336c" },
  { name: "Röd", hex: "#c0392b" },
  { name: "Orange", hex: "#d9480f" },
  { name: "Guld", hex: "#b08900" },
  { name: "Grön", hex: "#2b8a3e" },
  { name: "Petrol", hex: "#0b7285" },
] as const;

export type InvoiceDesign = {
  template: InvoiceTemplate;
  color: string;
  footer: string;
  swishNumber: string;
  swishQr: boolean;
  paymentLink: string;
  showLogo: boolean;
};

export const isTemplate = (t: string): t is InvoiceTemplate => INVOICE_TEMPLATES.some((x) => x.key === t);
export const validHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c);

/** Normaliserar ett Swish-nummer till bara siffror (t.ex. "123 456 78 90" → "1234567890"). */
export const swishDigits = (s: string) => s.replace(/\D/g, "");
export const validSwish = (s: string) => /^(123\d{7}|07\d{8})$/.test(swishDigits(s));

/** Endast http(s)-länkar tillåts som betallänk. */
export function safeLink(s: string) {
  try {
    const u = new URL(s.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}
