"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { bookBankAction, ignoreBankAction, type BookResult } from "@/app/(app)/bank/actions";
import type { Choice, Proposal } from "@/lib/bank";
import { kr } from "@/lib/money";
import { AccountPicker } from "./AccountPicker";

type Row = { id: number; date: string; text: string; reference: string; amount: number; bankAccount: number; proposals: Proposal[] };
type Template = { id: number; name: string; direction: string };
type Account = { number: number; name: string };

// Valet per rad: ett förslag (p:index), en mall (t:id) eller ett eget konto (a).
type Pick = { key: string; account?: string; vat?: number };

const FILTERS = [
  ["all", "Alla"],
  ["high", "Säkra"],
  ["medium", "Kontrollera"],
  ["none", "Utan förslag"],
] as const;

function level(r: Row): "high" | "medium" | "none" {
  return r.proposals[0]?.confidence ?? "none";
}

export function BankQueue({ rows, templates, accounts }: { rows: Row[]; templates: Template[]; accounts: Account[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picks, setPicks] = useState<Record<number, Pick>>(() => Object.fromEntries(rows.filter((r) => r.proposals.length).map((r) => [r.id, { key: "p:0" }])));
  const [checked, setChecked] = useState<Set<number>>(() => new Set(rows.filter((r) => r.proposals.length).map((r) => r.id)));
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const [result, setResult] = useState<(BookResult & { ids: Record<number, string> }) | null>(null);

  const choiceFor = (r: Row): Choice | null => {
    const p = picks[r.id];
    if (!p) return null;
    if (p.key.startsWith("p:")) return r.proposals[Number(p.key.slice(2))]?.choice ?? null;
    if (p.key.startsWith("t:")) return { kind: "template", templateId: Number(p.key.slice(2)) };
    if (p.key === "a" && p.account && /^\d{4}$/.test(p.account)) {
      return { kind: "account", account: Number(p.account), vatRate: p.vat ?? 0, direction: r.amount > 0 ? "sale" : "purchase" };
    }
    return null;
  };

  const shown = rows.filter((r) => filter === "all" || level(r) === filter);
  const ready = rows.filter((r) => checked.has(r.id) && choiceFor(r));
  const stats = useMemo(() => ({ high: rows.filter((r) => level(r) === "high").length, medium: rows.filter((r) => level(r) === "medium").length, none: rows.filter((r) => level(r) === "none").length }), [rows]);
  const allShownChecked = shown.length > 0 && shown.every((r) => checked.has(r.id));

  const setPick = (id: number, p: Pick) => {
    setPicks((x) => ({ ...x, [id]: p }));
    setChecked((x) => new Set(x).add(id));
  };

  const book = () => {
    const items = ready.map((r) => ({ id: r.id, choice: choiceFor(r)! }));
    start(async () => {
      const res = await bookBankAction(items);
      setResult({ ...res, ids: Object.fromEntries(res.failed.map((f) => [f.id, f.error])) });
      router.refresh();
    });
  };

  const ignore = () => {
    const ids = rows.filter((r) => checked.has(r.id)).map((r) => r.id);
    if (!ids.length || !confirm(`Ignorera ${ids.length} transaktioner? De bokförs inte, men kan återställas.`)) return;
    start(async () => {
      await ignoreBankAction(ids);
      router.refresh();
    });
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="segmented" role="tablist">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-current={filter === k ? "page" : undefined} onClick={() => setFilter(k)}>
              {label} {k === "all" ? rows.length : stats[k]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={pending || checked.size === 0} onClick={ignore}>
            Ignorera
          </button>
          <button type="button" className="btn-primary" disabled={pending || ready.length === 0} onClick={book}>
            {pending ? "Bokför…" : `Bokför valda (${ready.length})`}
          </button>
        </div>
      </div>

      {result && (
        <p role="status" className={`border-b border-line px-4 py-2.5 text-[14px] font-medium ${result.failed.length ? "bg-warn-soft text-warn" : "bg-success-soft text-success"}`}>
          {result.booked} transaktioner bokförda.{result.failed.length ? ` ${result.failed.length} kunde inte bokföras – se raderna nedan.` : ""}
        </p>
      )}

      <div className="flex items-center gap-3 border-b border-line px-4 py-2 text-[12px] font-medium text-muted">
        <input
          type="checkbox"
          aria-label="Markera alla"
          className="h-4 w-4 accent-[var(--brand)]"
          checked={allShownChecked}
          onChange={(e) =>
            setChecked((x) => {
              const n = new Set(x);
              for (const r of shown) {
                if (e.target.checked) n.add(r.id);
                else n.delete(r.id);
              }
              return n;
            })
          }
        />
        <span className="hidden w-[5.5rem] sm:block">Datum</span>
        <span className="flex-1">Transaktion och bokföring</span>
        <span className="hidden sm:block">Belopp</span>
      </div>

      {shown.length === 0 && <p className="px-5 py-10 text-center text-[15px] text-muted">Inga transaktioner i den här vyn.</p>}

      <ul className="divide-y divide-line">
        {shown.map((r) => {
          const p = picks[r.id];
          const incoming = r.amount > 0;
          const prop = p?.key.startsWith("p:") ? r.proposals[Number(p.key.slice(2))] : undefined;
          const error = result?.ids[r.id];
          const tpls = templates.filter((t) => (t.direction === "sale") === incoming);
          return (
            <li key={r.id} className="flex items-start gap-3 px-4 py-3">
              <input
                type="checkbox"
                aria-label={`Markera ${r.text}`}
                className="mt-2.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
                checked={checked.has(r.id)}
                onChange={(e) =>
                  setChecked((x) => {
                    const n = new Set(x);
                    if (e.target.checked) n.add(r.id);
                    else n.delete(r.id);
                    return n;
                  })
                }
              />
              <span className="mt-2 hidden w-[5.5rem] shrink-0 text-[13px] tabular-nums text-muted sm:block">{r.date}</span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="mt-1.5 min-w-0 truncate text-[15px] font-medium">
                    <span className="mr-2 text-[13px] font-normal tabular-nums text-muted sm:hidden">{r.date.slice(5)}</span>
                    {r.text}
                    {r.reference && <span className="ml-2 text-[13px] font-normal text-muted">{r.reference}</span>}
                  </p>
                  <span className={`num shrink-0 text-[15px] font-semibold ${incoming ? "text-success" : ""}`}>{kr(r.amount)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Bokföring"
                    className="input min-w-0 flex-1 basis-full py-1.5 text-[14px] sm:max-w-md sm:basis-auto"
                    value={p?.key ?? ""}
                    onChange={(e) => setPick(r.id, { key: e.target.value, account: p?.account, vat: p?.vat ?? 25 })}
                  >
                    <option value="" disabled>
                      Välj hur transaktionen ska bokföras…
                    </option>
                    {r.proposals.length > 0 && (
                      <optgroup label="Förslag">
                        {r.proposals.map((x, i) => (
                          <option key={i} value={`p:${i}`}>
                            {x.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label={incoming ? "Mallar för intäkter" : "Mallar för kostnader"}>
                      {tpls.map((t) => (
                        <option key={t.id} value={`t:${t.id}`}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Annat">
                      <option value="a">Välj konto…</option>
                    </optgroup>
                  </select>
                  {prop && (
                    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${prop.confidence === "high" ? "bg-success-soft text-success" : "bg-warn-soft text-warn"}`}>
                      {prop.confidence === "high" ? "Säker" : "Kontrollera"}
                    </span>
                  )}
                </div>
                {p?.key === "a" && (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="w-72 max-w-full">
                      <AccountPicker accounts={accounts.filter((a) => a.number !== r.bankAccount)} value={p.account ?? ""} onChange={(v) => setPick(r.id, { ...p, account: v })} />
                    </div>
                    <select aria-label="Moms" className="input w-auto py-1.5 text-[14px]" value={p.vat ?? 25} onChange={(e) => setPick(r.id, { ...p, vat: Number(e.target.value) })}>
                      {[25, 12, 6, 0].map((v) => (
                        <option key={v} value={v}>
                          {v ? `${v} % moms` : "Ingen moms"}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {prop && <p className="text-[12px] text-muted">{prop.reason}</p>}
                {error && <p className="text-[13px] font-medium text-danger">{error}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
