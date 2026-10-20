"use client";

import { useState } from "react";

type Line = { description: string; quantity: string; unit: string; unitPrice: string; vatRate: string };
type Article = { id: number; name: string; unit: string; price: number; vatRate: number };

const toNum = (s: string) => Number(String(s).replace(/\s/g, "").replace(",", ".")) || 0;
const fmt = (n: number) => n.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const emptyLine = (): Line => ({ description: "", quantity: "1", unit: "st", unitPrice: "", vatRate: "25" });

export function InvoiceEditor({
  invoice,
  customers,
  articles,
  action,
  sendAction,
}: {
  invoice: {
    id: number;
    customerId: number;
    date: string;
    dueDate: string;
    ourReference: string;
    theirReference: string;
    notes: string;
    lines: { description: string; quantity: number; unit: string; unitPrice: number; vatRate: number }[];
  };
  customers: { id: number; name: string }[];
  articles: Article[];
  action: (fd: FormData) => Promise<void>;
  sendAction: (fd: FormData) => Promise<void>;
}) {
  const [lines, setLines] = useState<Line[]>(
    invoice.lines.length
      ? invoice.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unit: l.unit, unitPrice: (l.unitPrice / 100).toFixed(2).replace(".", ","), vatRate: String(l.vatRate) }))
      : [emptyLine()],
  );
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addArticle = (id: string) => {
    const a = articles.find((x) => String(x.id) === id);
    if (!a) return;
    const line = { description: a.name, quantity: "1", unit: a.unit, unitPrice: (a.price / 100).toFixed(2).replace(".", ","), vatRate: String(a.vatRate) };
    setLines(lines.length === 1 && !lines[0].description && !lines[0].unitPrice ? [line] : [...lines, line]);
  };

  const byRate = new Map<number, number>();
  for (const l of lines) {
    const r = Number(l.vatRate);
    byRate.set(r, (byRate.get(r) ?? 0) + toNum(l.quantity) * toNum(l.unitPrice));
  }
  const net = [...byRate.values()].reduce((s, v) => s + v, 0);
  const vat = [...byRate.entries()].reduce((s, [r, v]) => s + Math.round(v * r) / 100, 0);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="id" value={invoice.id} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="label" htmlFor="customerId">Kund</label>
          <select id="customerId" name="customerId" defaultValue={invoice.customerId} className="input">
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="date">Fakturadatum</label>
          <input id="date" type="date" name="date" defaultValue={invoice.date} required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="dueDate">Förfallodatum</label>
          <input id="dueDate" type="date" name="dueDate" defaultValue={invoice.dueDate} required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="ourReference">Vår referens</label>
          <input id="ourReference" name="ourReference" defaultValue={invoice.ourReference} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="theirReference">Er referens</label>
          <input id="theirReference" name="theirReference" defaultValue={invoice.theirReference} className="input" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="table table-edit min-w-[760px]">
          <thead>
            <tr>
              <th>Beskrivning</th>
              <th className="w-24">Antal</th>
              <th className="w-20">Enhet</th>
              <th className="w-32">À-pris</th>
              <th className="w-28">Moms</th>
              <th className="num w-32">Summa</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td><input aria-label="Beskrivning" value={l.description} onChange={(e) => set(i, { description: e.target.value })} className="input min-w-48" /></td>
                <td><input aria-label="Antal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} className="input text-right" inputMode="decimal" /></td>
                <td><input aria-label="Enhet" value={l.unit} onChange={(e) => set(i, { unit: e.target.value })} className="input" /></td>
                <td><input aria-label="À-pris" value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} className="input text-right" inputMode="decimal" /></td>
                <td>
                  <select aria-label="Moms" value={l.vatRate} onChange={(e) => set(i, { vatRate: e.target.value })} className="input">
                    <option value="25">25 %</option>
                    <option value="12">12 %</option>
                    <option value="6">6 %</option>
                    <option value="0">0 %</option>
                  </select>
                </td>
                <td className="num">{fmt(toNum(l.quantity) * toNum(l.unitPrice))}</td>
                <td>
                  <button type="button" aria-label="Ta bort rad" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-muted hover:text-danger">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center gap-3 p-3">
          <button type="button" onClick={() => setLines([...lines, emptyLine()])} className="btn-secondary">+ Rad</button>
          {articles.length > 0 && (
            <select aria-label="Lägg till artikel" value="" onChange={(e) => addArticle(e.target.value)} className="input w-auto">
              <option value="">+ Lägg till artikel…</option>
              {articles.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="notes">Meddelande på fakturan</label>
          <textarea id="notes" name="notes" defaultValue={invoice.notes} rows={3} className="input" />
        </div>
        <div className="space-y-1 self-end text-sm">
          <div className="flex justify-between"><span>Exkl. moms</span><span className="tabular-nums">{fmt(net)} kr</span></div>
          <div className="flex justify-between"><span>Moms</span><span className="tabular-nums">{fmt(vat)} kr</span></div>
          <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><span>Att betala</span><span className="tabular-nums">{fmt(net + vat)} kr</span></div>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-secondary">Spara utkast</button>
        <button
          formAction={sendAction}
          className="btn-primary"
          onClick={(e) => {
            if (!confirm("Bokför fakturan? Den får ett fakturanummer och kan sedan inte ändras, bara krediteras.")) e.preventDefault();
          }}
        >
          Bokför faktura
        </button>
      </div>
    </form>
  );
}
