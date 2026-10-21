"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { bankImportAction } from "@/app/(app)/bank/actions";
import type { Mapping } from "@/lib/bank-csv";
import { kr } from "@/lib/money";
import { Icon } from "./Icon";

const FIELDS: [keyof Mapping, string][] = [
  ["date", "Datum"],
  ["amount", "Belopp"],
  ["text", "Text"],
  ["balance", "Saldo"],
];

export function BankImporter({ bankAccounts }: { bankAccounts: { number: number; name: string }[] }) {
  const [state, dispatch, pending] = useActionState(bankImportAction, undefined);
  const [file, setFile] = useState<File | null>(null);
  const [bankAccount, setBankAccount] = useState(String(bankAccounts.find((a) => a.number === 1930)?.number ?? bankAccounts[0]?.number ?? 1930));
  const [override, setOverride] = useState<Partial<Mapping>>({});
  const [invert, setInvert] = useState(false);
  const [auto, setAuto] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  const send = (opts: { confirm?: boolean; f?: File | null; override?: Partial<Mapping>; invert?: boolean; account?: string } = {}) => {
    const f = opts.f ?? file;
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    fd.append("bankAccount", opts.account ?? bankAccount);
    for (const [k, v] of Object.entries(opts.override ?? override)) fd.append(`m_${k}`, String(v));
    if (opts.invert ?? invert) fd.append("invert", "on");
    if (opts.confirm) {
      fd.append("confirm", "1");
      if (auto) fd.append("autoBook", "on");
    }
    startTransition(() => dispatch(fd));
  };

  const reset = () => {
    setFile(null);
    setOverride({});
    setInvert(false);
    const fd = new FormData();
    fd.append("reset", "1");
    startTransition(() => dispatch(fd));
  };

  if (state?.step === "done") {
    const rest = state.created - state.booked;
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl bg-success-soft p-4 text-success">
          <Icon name="check" className="mt-0.5 h-5 w-5" />
          <div className="text-[15px]">
            <p className="font-semibold">{state.created} transaktioner importerade</p>
            <p>
              {state.booked > 0 ? `${state.booked} bokfördes automatiskt. ` : ""}
              {rest > 0 ? `${rest} väntar på dig nedan.` : "Allt är bokfört."}
              {state.duplicates > 0 ? ` ${state.duplicates} fanns redan och hoppades över.` : ""}
            </p>
          </div>
        </div>
        <button type="button" className="btn-secondary" onClick={reset}>
          Importera en till fil
        </button>
      </div>
    );
  }

  const plan = state?.step === "plan" ? state : null;
  const mapping = plan?.mapping;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-dashed border-[var(--line-strong)] p-5">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-soft text-brand">
          <Icon name="bank" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">{file ? file.name : "Välj en CSV-fil från banken"}</p>
          <p className="text-[13px] text-muted">{pending ? "Läser in…" : "Swedbank, SEB, Handelsbanken, Nordea, Länsförsäkringar, Danske Bank m.fl."}</p>
        </div>
        <select
          aria-label="Bankkonto"
          className="input w-auto"
          value={bankAccount}
          disabled={pending}
          onChange={(e) => {
            setBankAccount(e.target.value);
            if (file) send({ account: e.target.value });
          }}
        >
          {bankAccounts.map((a) => (
            <option key={a.number} value={a.number}>
              {a.number} {a.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn-secondary" disabled={pending} onClick={() => input.current?.click()}>
          {file ? "Byt fil" : "Välj fil"}
        </button>
        <input
          ref={input}
          type="file"
          accept=".csv,.txt,.tsv,text/csv,text/plain"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setOverride({});
            if (f) send({ f, override: {} });
            e.target.value = "";
          }}
        />
      </div>

      {state?.step === "error" && (
        <p role="alert" className="rounded-xl bg-danger-soft p-3 text-[14px] font-medium text-danger">
          {state.error}
        </p>
      )}

      {plan && mapping && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 text-[14px] lg:grid-cols-[1fr_1.7fr_1fr_1fr]">
            {(
              [
                ["Format", plan.bank],
                ["Period", `${plan.from} – ${plan.to}`],
                ["Nya transaktioner", String(plan.fresh)],
                ["Redan importerade", String(plan.duplicates)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-surface-2 p-3">
                <p className="text-[12px] text-muted">{k}</p>
                <p className="truncate text-[17px] font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>

          <details className="rounded-xl bg-surface-2 p-3 text-[14px]" open={plan.bank.startsWith("Bank")}>
            <summary className="cursor-pointer font-medium">Kolumner</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              {FIELDS.map(([key, label]) => (
                <div key={key}>
                  <label className="label" htmlFor={`m-${key}`}>{label}</label>
                  <select
                    id={`m-${key}`}
                    className="input"
                    value={override[key] ?? mapping[key]}
                    disabled={pending}
                    onChange={(e) => {
                      const next = { ...override, [key]: Number(e.target.value) };
                      setOverride(next);
                      send({ override: next });
                    }}
                  >
                    {(key === "date" || key === "amount" ? [] : [[-1, "Ingen"] as const]).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                    {plan.headers.map((h, i) => (
                      <option key={i} value={i}>{h || `Kolumn ${i + 1}`}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--brand)]"
                checked={invert}
                disabled={pending}
                onChange={(e) => {
                  setInvert(e.target.checked);
                  send({ invert: e.target.checked });
                }}
              />
              Vänd tecken på beloppen (om uttag står som positiva belopp)
            </label>
          </details>

          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Text</th>
                  <th className="text-right">Belopp</th>
                </tr>
              </thead>
              <tbody>
                {plan.sample.map((r, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap tabular-nums">{r.date}</td>
                    <td className="max-w-[22rem] truncate">{r.text}</td>
                    <td className={`num ${r.amount < 0 ? "" : "text-success"}`}>{kr(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {plan.count > plan.sample.length && <p className="border-t border-line px-4 py-2 text-[13px] text-muted">… och {plan.count - plan.sample.length} till</p>}
          </div>

          {plan.warnings.map((w) => (
            <p key={w} className="rounded-xl bg-warn-soft p-3 text-[14px] text-warn">{w}</p>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-start gap-3 text-[14px]">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--brand)]" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              <span>
                <span className="block font-medium">Bokför säkra matchningar automatiskt</span>
                <span className="text-[13px] text-muted">Kundbetalningar, kvitton, utlägg och motparter du bokfört förut. Övriga får du granska.</span>
              </span>
            </label>
            <button type="button" className="btn-primary" disabled={pending || plan.fresh === 0} onClick={() => send({ confirm: true })}>
              {pending ? "Importerar…" : plan.fresh === 0 ? "Inget nytt att importera" : `Importera ${plan.fresh} transaktioner`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
