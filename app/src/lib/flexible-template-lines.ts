/**
 * Generell beräkning av bokföringsmallar.
 * Alla belopp är ören. Beloppsregler: gross, net, vat, percent_gross, fixed, remainder.
 */
export type FlexibleTemplateLine = {
  account: number;
  side: "debit" | "credit";
  rule: "gross" | "net" | "vat" | "percent_gross" | "fixed" | "remainder";
  value?: number;
  text?: string;
};
export type FlexibleTemplate = { lines?: unknown; costAccount: number; vatRate: number; vatAccount: number | null; direction: string };
export type CalculatedTemplateLine = { account: number; debit: number; credit: number; text?: string };

export function calculateTemplateLines(
  template: FlexibleTemplate,
  gross: number,
  opts: { payAccount: number; noVat?: boolean },
): CalculatedTemplateLine[] {
  const raw = Array.isArray(template.lines) ? template.lines as FlexibleTemplateLine[] : [];
  if (!raw.length) {
    // Bakåtkompatibilitet för mallar skapade före fria konteringsrader.
    const rate = opts.noVat ? 0 : template.vatRate;
    const vat = rate ? Math.round(gross * rate / (100 + rate)) : 0;
    if (template.direction === "sale") {
      const outputVat: Record<number, number> = { 25: 2611, 12: 2621, 6: 2631 };
      return [
        { account: opts.payAccount, debit: gross, credit: 0 },
        { account: template.costAccount, debit: 0, credit: gross - vat },
        ...(vat ? [{ account: template.vatAccount ?? outputVat[rate] ?? 2611, debit: 0, credit: vat }] : []),
      ];
    }
    return [
      { account: template.costAccount, debit: gross - vat, credit: 0 },
      ...(vat ? [{ account: template.vatAccount ?? 2641, debit: vat, credit: 0 }] : []),
      { account: opts.payAccount, debit: 0, credit: gross },
    ];
  }

  const rate = opts.noVat ? 0 : template.vatRate;
  const vat = rate ? Math.round(gross * rate / (100 + rate)) : 0;
  const net = gross - vat;
  let debitTotal = 0;
  let creditTotal = 0;
  const output: CalculatedTemplateLine[] = [];
  const remainderIndexes = raw.map((line, index) => line?.rule === "remainder" ? index : -1).filter(index => index >= 0);
  if (remainderIndexes.length > 1 || (remainderIndexes.length === 1 && remainderIndexes[0] !== raw.length - 1)) {
    throw new Error("En restbeloppsrad måste vara den sista raden och får bara finnas en gång.");
  }
  for (const line of raw) {
    if (!line || !Number.isInteger(line.account) || line.account < 1000 || line.account > 8999) {
      throw new Error("En mallrad har ett ogiltigt konto.");
    }
    if (line.side !== "debit" && line.side !== "credit") throw new Error("En mallrad måste vara debet eller kredit.");
    let amount = 0;
    switch (line.rule) {
      case "gross": amount = gross; break;
      case "net": amount = net; break;
      case "vat": amount = vat; break;
      case "percent_gross":
        if (!Number.isFinite(line.value) || (line.value ?? 0) < 0 || (line.value ?? 0) > 1000) throw new Error("Procentregeln måste vara mellan 0 och 1000.");
        amount = Math.round(gross * (line.value ?? 0) / 100); break;
      case "fixed":
        if (!Number.isFinite(line.value) || (line.value ?? -1) < 0) throw new Error("Fast belopp ska anges i kronor och får inte vara negativt.");
        amount = Math.round((line.value ?? 0) * 100); break;
      case "remainder":
        amount = line.side === "debit" ? creditTotal - debitTotal : debitTotal - creditTotal;
        if (amount < 0) throw new Error("Restbeloppsradens sida stämmer inte med obalansen i mallen.");
        break;
      default: throw new Error("Mallen innehåller en okänd beloppsregel.");
    }
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Mallraden gav ett ogiltigt belopp.");
    output.push({ account: line.account, debit: line.side === "debit" ? amount : 0, credit: line.side === "credit" ? amount : 0, text: (line.text ?? "").slice(0, 200) });
    if (line.side === "debit") debitTotal += amount; else creditTotal += amount;
  }
  if (output.length < 2) throw new Error("En mall måste ha minst två konteringsrader.");
  if (debitTotal !== creditTotal) throw new Error("Mallen balanserar inte. Lägg till en restbeloppsrad sist eller justera beloppen.");
  return output.filter(l => l.debit || l.credit);
}
