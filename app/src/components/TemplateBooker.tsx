"use client";

import { useState } from "react";
import { ConfirmButton } from "./ConfirmButton";

type Template = { id: number; name: string; category: string; costAccount: number; vatRate: number; direction: string; keywords: string };

const fmt = (ore: number) => (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function TemplateBooker({
  templates,
  accountNames,
  action,
  uploadId,
}: {
  templates: Template[];
  accountNames: Record<number, string>;
  action: (fd: FormData) => Promise<void>;
  uploadId?: number;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Template | null>(null);
  const [amount, setAmount] = useState("");
  const [payment, setPayment] = useState("1930");

  const filtered = templates.filter((t) => `${t.name} ${t.category} ${t.keywords} ${t.costAccount}`.toLowerCase().includes(q.toLowerCase()));
  const gross = Math.round(Number(amount.replace(/\s/g, "").replace(",", ".")) * 100) || 0;

  // Förhandsvisning av konteringen, samma logik som på servern.
  let preview: [number, number, number][] = [];
  if (selected && gross > 0) {
    const pay = Number(payment);
    if (selected.direction === "reverse") {
      const vat = Math.round((gross * selected.vatRate) / 100);
      preview = [[selected.costAccount, gross, 0], [2645, vat, 0], [2614, 0, vat], [pay, 0, gross]];
    } else {
      const vat = selected.vatRate ? Math.round((gross * selected.vatRate) / (100 + selected.vatRate)) : 0;
      const outVat = { 25: 2611, 12: 2621, 6: 2631 }[selected.vatRate] ?? 2611;
      preview =
        selected.direction === "sale"
          ? [[pay, gross, 0], [selected.costAccount, 0, gross - vat], [outVat, 0, vat]]
          : [[selected.costAccount, gross - vat, 0], [2641, vat, 0], [pay, 0, gross]];
    }
    preview = preview.filter(([, d, c]) => d || c);
  }

  if (!selected) {
    return (
      <div>
        <label className="label" htmlFor="tq">Vad gäller underlaget?</label>
        <input id="tq" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sök mall, t.ex. hotell, programvara, försäljning" className="input" />
        <ul className="mt-3 max-h-96 divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {filtered.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => setSelected(t)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-surface-2">
                <span>
                  {t.name}
                  <span className="block text-xs text-muted">{t.category} · konto {t.costAccount} · moms {t.vatRate} %</span>
                </span>
                <span className="text-muted">→</span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="px-3 py-4 text-sm text-muted">Ingen mall matchar. Bokför manuellt istället.</li>}
        </ul>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="templateId" value={selected.id} />
      {uploadId && <input type="hidden" name="uploadId" value={uploadId} />}
      <div className="flex items-center justify-between rounded-xl bg-brand-soft px-3 py-2 text-sm">
        <span>
          Mall: <strong>{selected.name}</strong>
        </span>
        <button type="button" onClick={() => setSelected(null)} className="text-brand underline">Byt</button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="date">Datum (enligt underlaget)</label>
          <input id="date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="amount">{selected.direction === "reverse" ? "Belopp (utan moms)" : "Belopp inkl. moms"}</label>
          <input id="amount" name="amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input text-right" placeholder="0,00" />
        </div>
        <div>
          <label className="label" htmlFor="paymentAccount">{selected.direction === "sale" ? "Pengarna kom in på" : "Betalt från"}</label>
          <select id="paymentAccount" name="paymentAccount" value={payment} onChange={(e) => setPayment(e.target.value)} className="input">
            <option value="1930">1930 Företagskonto</option>
            <option value="1910">1910 Kassa</option>
            <option value="2893">2893 Privat (skuld till ägare)</option>
            <option value="2440">2440 Leverantörsskuld (obetald)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="description">Beskrivning</label>
          <input id="description" name="description" defaultValue={selected.name} className="input" />
        </div>
      </div>
      {preview.length > 0 && (
        <div className="rounded-xl border border-line">
          <p className="border-b border-line px-3 py-2 text-xs font-medium text-muted">Så här bokförs det</p>
          <table className="table">
            <tbody>
              {preview.map(([acc, d, c], i) => (
                <tr key={i}>
                  <td className="w-16">{acc}</td>
                  <td>{accountNames[acc] ?? ""}</td>
                  <td className="num">{d ? fmt(d) : ""}</td>
                  <td className="num">{c ? fmt(c) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end">
        <ConfirmButton>Bokför</ConfirmButton>
      </div>
    </form>
  );
}
