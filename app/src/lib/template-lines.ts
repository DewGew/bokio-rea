// Kontering för en bokföringsmall. Ren funktion som används både i webbläsaren (förhandsvisning)
// och på servern (bokföring), så att det som visas alltid är det som bokförs.

export type Country = "se" | "eu" | "world";
export type TemplateLike = { costAccount: number; vatRate: number; vatAccount: number | null; direction: string };
export type TemplateLine = { account: number; debit: number; credit: number };

const OUTPUT_VAT: Record<number, number> = { 25: 2611, 12: 2621, 6: 2631 };

/** Inköp från EU/utanför EU (tjänster): omvänd skattskyldighet med 25 % på konto 4535/4531 (momsruta 21/22, 30, 48). */
const FOREIGN_ACCOUNT: Record<Exclude<Country, "se">, number> = { eu: 4535, world: 4531 };

export function templateLines(
  t: TemplateLike,
  gross: number,
  opts: { country?: Country; payAccount: number; noVat?: boolean },
): TemplateLine[] {
  const country = opts.country ?? "se";
  const pay = opts.payAccount;
  const lines: TemplateLine[] = [];
  const add = (account: number, amount: number) => {
    if (amount) lines.push({ account, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0 });
  };

  const isSale = t.direction === "sale";
  const reverse = !opts.noVat && !isSale && (t.direction === "reverse" || country !== "se");

  if (reverse) {
    // Beloppet saknar svensk moms; momsen beräknas på beloppet och dras samtidigt som ingående moms.
    const account = t.direction === "reverse" && country === "se" ? t.costAccount : FOREIGN_ACCOUNT[country === "se" ? "world" : country];
    const vat = Math.round((gross * 25) / 100);
    add(account, gross);
    add(2645, vat);
    add(2614, -vat);
    add(pay, -gross);
    return lines;
  }

  const rate = opts.noVat ? 0 : t.vatRate;
  const vat = rate ? Math.round((gross * rate) / (100 + rate)) : 0;
  if (isSale) {
    add(pay, gross);
    add(t.costAccount, -(gross - vat));
    add(t.vatAccount ?? OUTPUT_VAT[rate] ?? 2611, -vat);
  } else {
    add(t.costAccount, gross - vat);
    add(rate ? (t.vatAccount ?? 2641) : 2641, vat);
    add(pay, -gross);
  }
  return lines;
}
