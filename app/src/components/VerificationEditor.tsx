"use client";

import { useMemo, useState } from "react";
import { ConfirmButton } from "./ConfirmButton";

type Row = { account: string; debit: string; credit: string; text: string };
const empty = (): Row => ({ account: "", debit: "", credit: "", text: "" });

function toOre(s: string) {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
const fmt = (ore: number) => (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function VerificationEditor({
  accounts,
  action,
  defaults,
}: {
  accounts: { number: number; name: string }[];
  action: (fd: FormData) => Promise<void>;
  defaults?: { date?: string; description?: string; uploadId?: number };
}) {
  const [rows, setRows] = useState<Row[]>([empty(), empty(), empty()]);
  const [problem, setProblem] = useState("");
  const names = useMemo(() => new Map(accounts.map((a) => [String(a.number), a.name])), [accounts]);
  const debit = rows.reduce((s, r) => s + toOre(r.debit), 0);
  const credit = rows.reduce((s, r) => s + toOre(r.credit), 0);
  const diff = debit - credit;

  const set = (i: number, patch: Partial<Row>) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    if (i === rows.length - 1 && (patch.account || patch.debit || patch.credit)) next.push(empty());
    setRows(next);
  };

  /** Fyll i differensen på raden så att verifikatet balanserar. */
  const balance = (i: number) => {
    const r = rows[i];
    const rest = diff - (toOre(r.debit) - toOre(r.credit));
    set(i, rest > 0 ? { credit: fmt(rest).replace(/\s/g, ""), debit: "" } : { debit: fmt(-rest).replace(/\s/g, ""), credit: "" });
  };

  return (
    <form
      action={action}
      className="space-y-5"
      onSubmit={(e) => {
        const msg = debit === 0 ? "Fyll i minst en debet- och en kreditrad." : diff !== 0 ? `Verifikatet balanserar inte, differens ${fmt(diff)}.` : rows.some((r) => (r.debit || r.credit) && !names.has(r.account)) ? "Någon rad har ett konto som inte finns." : "";
        setProblem(msg);
        if (msg) e.preventDefault();
      }}
    >
      <input type="hidden" name="lines" value={JSON.stringify(rows)} />
      {defaults?.uploadId && <input type="hidden" name="uploadId" value={defaults.uploadId} />}
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <div>
          <label className="label" htmlFor="date">Datum</label>
          <input id="date" type="date" name="date" required defaultValue={defaults?.date ?? new Date().toISOString().slice(0, 10)} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="description">Beskrivning</label>
          <input id="description" name="description" required defaultValue={defaults?.description} placeholder="T.ex. Inköp av dator" className="input" />
        </div>
      </div>

      <datalist id="accounts">
        {accounts.map((a) => (
          <option key={a.number} value={a.number}>{a.name}</option>
        ))}
      </datalist>

      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="table table-edit">
          <thead>
            <tr>
              <th className="w-32">Konto</th>
              <th>Benämning / radtext</th>
              <th className="num w-36">Debet</th>
              <th className="num w-36">Kredit</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <input list="accounts" aria-label="Konto" value={r.account} onChange={(e) => set(i, { account: e.target.value })} className="input" inputMode="numeric" />
                </td>
                <td>
                  <span className="block text-xs text-muted">{names.get(r.account) ?? (r.account ? "Okänt konto" : "")}</span>
                  <input aria-label="Radtext" value={r.text} onChange={(e) => set(i, { text: e.target.value })} className="input mt-1 py-1" placeholder="Valfri text" />
                </td>
                <td>
                  <input aria-label="Debet" value={r.debit} onChange={(e) => set(i, { debit: e.target.value })} className="input text-right" inputMode="decimal" />
                </td>
                <td>
                  <input aria-label="Kredit" value={r.credit} onChange={(e) => set(i, { credit: e.target.value })} className="input text-right" inputMode="decimal" />
                </td>
                <td>
                  <button type="button" title="Balansera på denna rad" onClick={() => balance(i)} className="text-muted hover:text-brand">=</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="px-3 py-2.5" colSpan={2}>
                Summa {diff !== 0 && <span className="ml-2 font-normal text-danger">Differens {fmt(diff)}</span>}
              </td>
              <td className="num px-3">{fmt(debit)}</td>
              <td className="num px-3">{fmt(credit)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex items-center justify-end gap-3">
        {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
        <ConfirmButton>Bokför</ConfirmButton>
      </div>
    </form>
  );
}
