// Belopp hanteras i öre. Formatering och tolkning enligt svensk standard.

const fmt = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtWhole = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });

export function kr(ore: number, opts: { decimals?: boolean } = {}): string {
  const value = ore / 100 || 0; // undvik "-0,00"
  return (opts.decimals === false ? fmtWhole.format(value) : fmt.format(value)) + " kr";
}

export function num(ore: number, decimals = true): string {
  return (decimals ? fmt : fmtWhole).format(ore / 100 || 0);
}

/** Tolkar "1 234,50", "1234.5", "-12" osv. till öre. Returnerar null om ogiltigt. */
export function parseKr(input: string | null | undefined): number | null {
  if (input == null) return null;
  const cleaned = String(input).replace(/\s| |kr/gi, "").replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Momsdel av ett belopp inkl. moms. */
export function vatFromGross(gross: number, rate: number): number {
  if (!rate) return 0;
  return Math.round((gross * rate) / (100 + rate));
}

export function dateStr(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

export function parseDate(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00.000Z");
  return Number.isNaN(d.getTime()) ? null : d;
}
