"use client";

import { useMemo, useState } from "react";
import { ConfirmButton } from "./ConfirmButton";

type Row = { account: string; amount: string };
const toOre = (s: string) => Math.round(Number(s.replace(/\s/g, "").replace(",", ".")) * 100) || 0;
const fmt = (ore: number) => (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Ingående balanser anges som saldon per konto: tillgångar (1xxx) som positiva belopp,
 * eget kapital och skulder (2xxx) också som positiva belopp – tecknet hanteras här.
 */
export function OpeningBalanceEditor({
  accounts,
  initial,
  action,
  readOnly,
}: {
  accounts: { number: number; name: string }[];
  initial: { account: number; amount: number }[];
  action: (fd: FormData) => Promise<void>;
  readOnly: boolean;
}) {
  const names = useMemo(() => new Map(accounts.map((a) => [String(a.number), a.name])), [accounts]);
  const toRow = (r: { account: number; amount: number }): Row => ({
    account: String(r.account),
    amount: fmt(r.account < 2000 ? r.amount : -r.amount).replace(/\s/g, ""),
  });
  const [rows, setRows] = useState<Row[]>(initial.length ? [...initial.map(toRow), { account: "", amount: "" }] : [{ account: "", amount: "" }]);

  const set = (i: number, patch: Partial<Row>) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    if (i === rows.length - 1 && (patch.account || patch.amount)) next.push({ account: "", amount: "" });
    setRows(next);
  };
  const assets = rows.filter((r) => r.account.startsWith("1")).reduce((s, r) => s + toOre(r.amount), 0);
  const claims = rows.filter((r) => r.account.startsWith("2")).reduce((s, r) => s + toOre(r.amount), 0);
  const diff = assets - claims;

  // Till servern skickas debet-positiva saldon (tillgångar +, eget kapital/skulder −).
  const payload = rows
    .filter((r) => r.account || r.amount)
    .map((r) => ({ account: r.account, amount: r.account.startsWith("2") ? String(-toOre(r.amount) / 100) : String(toOre(r.amount) / 100) }));

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="rows" value={JSON.stringify(payload)} />
      <datalist id="bs-accounts">
        {accounts.map((a) => (
          <option key={a.number} value={a.number}>{a.name}</option>
        ))}
      </datalist>
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="table table-edit min-w-[520px]">
          <thead>
            <tr>
              <th className="w-32">Konto</th>
              <th>Benämning</th>
              <th className="num w-44">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <input list="bs-accounts" aria-label="Konto" value={r.account} readOnly={readOnly} onChange={(e) => set(i, { account: e.target.value })} className="input" inputMode="numeric" />
                </td>
                <td className="text-[13px] text-muted">{names.get(r.account) ?? (r.account ? "Okänt balanskonto" : "")}</td>
                <td>
                  <input aria-label="Saldo" value={r.amount} readOnly={readOnly} onChange={(e) => set(i, { amount: e.target.value })} className="input text-right" inputMode="decimal" placeholder="0,00" />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-[14px]">
            <tr>
              <td className="px-4 py-2" colSpan={2}>Summa tillgångar (1xxx)</td>
              <td className="num px-4">{fmt(assets)}</td>
            </tr>
            <tr>
              <td className="px-4 py-2" colSpan={2}>Summa eget kapital och skulder (2xxx)</td>
              <td className="num px-4">{fmt(claims)}</td>
            </tr>
            <tr className={`font-semibold ${diff ? "text-danger" : "text-success"}`}>
              <td className="px-4 py-2" colSpan={2}>{diff ? "Differens – ska vara 0" : "Balanserar"}</td>
              <td className="num px-4">{fmt(diff)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {!readOnly && (
        <div className="flex justify-end">
          {diff === 0 ? <ConfirmButton>Spara ingående balanser</ConfirmButton> : <button disabled className="btn-primary">Spara ingående balanser</button>}
        </div>
      )}
    </form>
  );
}
