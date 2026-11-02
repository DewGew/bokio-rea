"use client";

import { useState } from "react";

type Line = { description: string; quantity: string; unit: string; unitPrice: string; vatRate: number; discount: string; type: string };
const empty = (): Line => ({ description: "", quantity: "1", unit: "st", unitPrice: "", vatRate: 25, discount: "0", type: "service" });

export function QuoteEditor({ quote, customers, action }: { quote: { id: number; customerId: number; date: string; validUntil: string; notes: string; lines: { description: string; quantity: number; unit: string; unitPrice: number; vatRate: number; discountBp: number; type: string }[] }; customers: { id: number; name: string }[]; action: (fd: FormData) => void | Promise<void> }) {
  const [lines, setLines] = useState<Line[]>(quote.lines.length ? quote.lines.map((l) => ({ ...l, quantity: String(l.quantity), unitPrice: (l.unitPrice / 100).toFixed(2).replace(".", ","), discount: String(l.discountBp / 100) })) : [empty()]);
  const update = (i: number, patch: Partial<Line>) => setLines((old) => old.map((l, n) => n === i ? { ...l, ...patch } : l));
  const total = lines.reduce((sum, l) => {
    const net = Math.round((Number(l.quantity.replace(",", ".")) || 0) * (Number(l.unitPrice.replace(",", ".")) || 0) * 100 * (1 - (Number(l.discount.replace(",", ".")) || 0) / 100));
    return sum + net + Math.round(net * l.vatRate / 100);
  }, 0);
  const money = (n: number) => (n / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " kr";
  return <form action={action} className="space-y-5">
    <input type="hidden" name="id" value={quote.id} />
    <input type="hidden" name="lines" value={JSON.stringify(lines)} />
    <div className="grid gap-3 sm:grid-cols-3">
      <div><label className="label" htmlFor="customerId">Kund</label><select id="customerId" name="customerId" defaultValue={quote.customerId} className="input">{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div><label className="label" htmlFor="date">Offertdatum</label><input id="date" type="date" name="date" defaultValue={quote.date} required className="input" /></div>
      <div><label className="label" htmlFor="validUntil">Giltig till</label><input id="validUntil" type="date" name="validUntil" defaultValue={quote.validUntil} required className="input" /></div>
    </div>
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="table min-w-[760px]"><thead><tr><th>Beskrivning</th><th>Antal</th><th>Enhet</th><th>À-pris exkl.</th><th>Rabatt %</th><th>Moms</th><th /></tr></thead>
        <tbody>{lines.map((l, i) => <tr key={i}>
          <td><input aria-label="Beskrivning" className="input min-w-40" value={l.description} onChange={e => update(i, { description: e.target.value })} required /></td>
          <td><input aria-label="Antal" className="input w-20" value={l.quantity} onChange={e => update(i, { quantity: e.target.value })} /></td>
          <td><input aria-label="Enhet" className="input w-20" value={l.unit} onChange={e => update(i, { unit: e.target.value })} /></td>
          <td><input aria-label="À-pris exklusive moms" className="input w-28" value={l.unitPrice} onChange={e => update(i, { unitPrice: e.target.value })} /></td>
          <td><input aria-label="Rabatt" className="input w-20" value={l.discount} onChange={e => update(i, { discount: e.target.value })} /></td>
          <td><select aria-label="Moms" className="input w-20" value={l.vatRate} onChange={e => update(i, { vatRate: Number(e.target.value) })}><option value={25}>25 %</option><option value={12}>12 %</option><option value={6}>6 %</option><option value={0}>0 %</option></select></td>
          <td><button type="button" aria-label="Ta bort rad" className="text-danger" onClick={() => setLines(old => old.length > 1 ? old.filter((_, n) => n !== i) : [empty()])}>×</button></td>
        </tr>)}</tbody>
      </table>
      <button type="button" className="btn-secondary m-3" onClick={() => setLines(old => [...old, empty()])}>+ Lägg till rad</button>
    </div>
    <div><label className="label" htmlFor="notes">Meddelande på offerten</label><textarea id="notes" name="notes" defaultValue={quote.notes} rows={3} className="input" /></div>
    <p className="text-right text-base font-semibold">Preliminärt totalbelopp inkl. moms: {money(total)}</p>
    <div className="flex justify-end"><button className="btn-primary">Spara offert</button></div>
  </form>;
}
