"use client";

import { useState } from "react";

type Line = { account: string; side: "debit" | "credit"; rule: "gross" | "net" | "vat" | "percent_gross" | "fixed" | "remainder"; value: string; text: string };
const fresh = (): Line => ({ account: "", side: "debit", rule: "gross", value: "", text: "" });
const RULES = [
  ["gross", "Hela beloppet"],
  ["net", "Belopp exkl. moms"],
  ["vat", "Momsbelopp"],
  ["percent_gross", "Procent av totalbeloppet"],
  ["fixed", "Fast belopp (kr)"],
  ["remainder", "Återstående belopp för att balansera"],
] as const;

export function TemplateLinesEditor({ accounts }: { accounts: { number: number; name: string }[] }) {
  const [rows, setRows] = useState<Line[]>([
    { account: "", side: "debit", rule: "net", value: "", text: "" },
    { account: "", side: "debit", rule: "vat", value: "", text: "" },
    { account: "", side: "credit", rule: "remainder", value: "", text: "" },
  ]);
  const update = (i: number, patch: Partial<Line>) => setRows(old => old.map((r, j) => j === i ? { ...r, ...patch } : r));
  return (
    <div className="grid gap-2">
      <input type="hidden" name="lines" value={JSON.stringify(rows.filter(r => r.account).map(r => ({ account: Number(r.account), side: r.side, rule: r.rule, ...(r.value !== "" ? { value: Number(r.value.replace(",", ".")) } : {}), text: r.text })))} />
      <p className="text-xs text-muted">Lägg till så många rader du behöver. Beloppen beräknas automatiskt från totalbeloppet och vald regel.</p>
      {rows.map((r, i) => (
        <div key={i} className="rounded-xl border border-line p-3 grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <select aria-label="Konto" className="input" value={r.account} onChange={e => update(i, { account: e.target.value })}>
              <option value="">Välj konto</option>
              {accounts.map(a => <option key={a.number} value={a.number}>{a.number} {a.name}</option>)}
            </select>
            <select aria-label="Debet eller kredit" className="input" value={r.side} onChange={e => update(i, { side: e.target.value as Line["side"] })}>
              <option value="debit">Debet</option><option value="credit">Kredit</option>
            </select>
          </div>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <select aria-label="Beloppsregel" className="input" value={r.rule} onChange={e => update(i, { rule: e.target.value as Line["rule"] })}>
              {RULES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
            {(["percent_gross", "fixed"] as string[]).includes(r.rule) ? <input aria-label="Regelvärde" className="input" placeholder={r.rule === "fixed" ? "Kr" : "%"} value={r.value} onChange={e => update(i, { value: e.target.value })} /> : <span />}
          </div>
          <input aria-label="Radtext" className="input" placeholder="Radtext (valfritt)" value={r.text} onChange={e => update(i, { text: e.target.value })} />
          <div className="flex justify-end">
            <button type="button" className="text-xs text-danger" onClick={() => setRows(old => old.filter((_, j) => j !== i))}>Ta bort rad</button>
          </div>
        </div>
      ))}
      <button type="button" className="rounded-lg border border-line px-3 py-2 text-sm" onClick={() => setRows(old => [...old, fresh()])}>+ Lägg till konteringsrad</button>
    </div>
  );
}
