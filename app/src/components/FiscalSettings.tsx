"use client";

import { useActionState, useState } from "react";
import { fiscalYearAction, saveTaxSettings, type SettingsState } from "@/app/(app)/settings/fiscal/actions";
import { ConfirmButton } from "./ConfirmButton";

const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

function Message({ state }: { state: SettingsState }) {
  if (!state?.error && !state?.ok) return null;
  return (
    <p role={state.error ? "alert" : "status"} className={`text-[14px] font-medium ${state.error ? "text-danger" : "text-success"}`}>
      {state.error ?? state.ok}
    </p>
  );
}

/** Valbara kort (radioknappar) i iOS-stil. */
function Choice<T extends string>({
  name,
  value,
  onChange,
  options,
  cols = 2,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string; disabled?: boolean }[];
  cols?: 2 | 3 | 4;
}) {
  const grid = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[cols];
  return (
    <div role="radiogroup" className={`grid gap-2 ${grid}`}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <label
            key={o.value}
            className={`flex cursor-pointer flex-col rounded-xl p-3 transition ${on ? "bg-brand-soft ring-2 ring-brand" : "bg-surface-2 hover:bg-fill"} ${o.disabled ? "pointer-events-none opacity-40" : ""}`}
          >
            <input type="radio" name={name} value={o.value} checked={on} disabled={o.disabled} onChange={() => onChange(o.value)} className="sr-only" />
            <span className="text-[15px] font-semibold">{o.label}</span>
            {o.hint && <span className="mt-0.5 text-[12px] leading-snug text-muted">{o.hint}</span>}
          </label>
        );
      })}
    </div>
  );
}

export type TaxValues = { companyType: string; accountingMethod: string; vatPeriod: string; euTrade: boolean; fiscalStartMonth: number };

export function TaxSettingsForm({ initial, unpaidInvoices }: { initial: TaxValues; unpaidInvoices: number }) {
  const [state, action] = useActionState(saveTaxSettings, undefined);
  const [v, setV] = useState(initial);
  const set = <K extends keyof TaxValues>(k: K, val: TaxValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const isEf = v.companyType === "ef";

  return (
    <form action={action} className="space-y-7">
      <section>
        <h3 className="mb-2 text-[15px] font-semibold">Företagsform</h3>
        <Choice
          name="companyType"
          value={v.companyType}
          onChange={(x) => {
            set("companyType", x);
            if (x === "ef") set("fiscalStartMonth", 1);
          }}
          cols={4}
          options={[
            { value: "ab", label: "Aktiebolag" },
            { value: "ef", label: "Enskild firma" },
            { value: "hb", label: "Handelsbolag", hint: "Även kommanditbolag" },
            { value: "ek", label: "Ekonomisk förening" },
          ]}
        />
      </section>

      <section>
        <h3 className="mb-2 text-[15px] font-semibold">Bokföringsmetod</h3>
        <Choice
          name="accountingMethod"
          value={v.accountingMethod}
          onChange={(x) => set("accountingMethod", x)}
          options={[
            { value: "invoice", label: "Fakturametoden", hint: "Kundfakturor bokförs när de skickas, betalningen bokförs separat." },
            { value: "cash", label: "Kontantmetoden", hint: "Fakturor bokförs först när de betalas. För företag med omsättning under 3 miljoner kr per år." },
          ]}
        />
        {v.accountingMethod === "cash" && (
          <p className="mt-2 text-[13px] text-muted">Vid räkenskapsårets slut ska obetalda kund- och leverantörsfakturor bokföras som fordringar respektive skulder.</p>
        )}
        {v.accountingMethod !== initial.accountingMethod && unpaidInvoices > 0 && (
          <p className="mt-2 text-[13px] text-warn">Du har {unpaidInvoices} obetalda fakturor. De måste vara betalda eller krediterade innan metoden kan bytas.</p>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-[15px] font-semibold">Momsredovisning</h3>
        <Choice
          name="vatPeriod"
          value={v.vatPeriod}
          onChange={(x) => set("vatPeriod", x)}
          cols={4}
          options={[
            { value: "month", label: "Månad", hint: "Obligatoriskt över 40 mnkr i momspliktig omsättning" },
            { value: "quarter", label: "Kvartal", hint: "Vanligast, upp till 40 mnkr" },
            { value: "year", label: "Helår", hint: "Upp till 1 mnkr. Perioden är räkenskapsåret" },
            { value: "none", label: "Ej momsregistrerad", hint: "Ingen moms dras eller redovisas" },
          ]}
        />
        {v.vatPeriod === "year" && (
          <label className="mt-3 flex items-center justify-between gap-4 rounded-xl bg-surface-2 p-3">
            <span>
              <span className="block text-[15px]">Handel med andra EU-länder</span>
              <span className="text-[12px] text-muted">Köp eller försäljning av varor/tjänster inom EU ger tidigare deklarationsdag för helårsmoms.</span>
            </span>
            <input type="checkbox" name="euTrade" checked={v.euTrade} onChange={(e) => set("euTrade", e.target.checked)} className="h-5 w-5 accent-[var(--brand)]" />
          </label>
        )}
        <p className="mt-2 text-[13px] text-muted">Redovisningsperioden bestäms av Skatteverket vid momsregistreringen. Byter du period gäller den nya från och med nästa olåsta period.</p>
      </section>

      <section>
        <h3 className="mb-2 text-[15px] font-semibold">Räkenskapsårets startmånad</h3>
        <select
          name="fiscalStartMonth"
          value={v.fiscalStartMonth}
          onChange={(e) => set("fiscalStartMonth", Number(e.target.value))}
          disabled={isEf}
          className="input max-w-xs"
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              1 {m} – {new Date(Date.UTC(2025, i, 0)).getUTCDate()} {MONTHS[(i + 11) % 12]} {i === 0 ? "(kalenderår)" : "(brutet räkenskapsår)"}
            </option>
          ))}
        </select>
        {isEf && <input type="hidden" name="fiscalStartMonth" value={1} />}
        <p className="mt-2 text-[13px] text-muted">
          {isEf ? "En enskild firma har alltid kalenderår som räkenskapsår." : "Gäller räkenskapsår som skapas framöver. Befintliga år ändrar du nedan."}
        </p>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
        <span className="mr-auto">
          <Message state={state} />
        </span>
        <ConfirmButton>Spara</ConfirmButton>
      </div>
    </form>
  );
}

export type FyRow = { id: number; label: string; start: string; end: string; months: number; closed: boolean; ended: boolean; verifications: number; current: boolean };

export function FiscalYearsTable({ years }: { years: FyRow[] }) {
  const [state, action] = useActionState(fiscalYearAction, undefined);
  const [editing, setEditing] = useState<number | null>(null);
  const last = years[years.length - 1];

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
        {[...years].reverse().map((y, idx) => {
          const isFirst = y.id === years[0].id;
          const isLast = y.id === last.id;
          return (
            <li key={y.id} className="bg-surface p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">
                    {y.label}
                    {y.current && <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-[12px] font-semibold text-brand">Pågår</span>}
                    {y.closed && <span className="ml-2 rounded-full bg-success-soft px-2 py-0.5 text-[12px] font-semibold text-success">Stängt</span>}
                    {y.months !== 12 && <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-[12px] font-semibold text-warn">{y.months} månader</span>}
                  </p>
                  <p className="text-[13px] text-muted">
                    {y.start} – {y.end} · {y.verifications} verifikat
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!y.closed && (isFirst || isLast) && (
                    <button type="button" onClick={() => setEditing(editing === y.id ? null : y.id)} className="btn-secondary px-3 py-1.5 text-[13px]">
                      {editing === y.id ? "Avbryt" : "Ändra datum"}
                    </button>
                  )}
                  {(y.ended || y.closed) && (
                    <a href={`/closing/${y.id}`} className="btn-secondary px-3 py-1.5 text-[13px]">
                      {y.closed ? "Bokslut" : "Gör bokslut"}
                    </a>
                  )}
                  {isLast && years.length > 1 && y.verifications === 0 && idx === 0 && (
                    <form action={action}>
                      <input type="hidden" name="intent" value="remove" />
                      <input type="hidden" name="id" value={y.id} />
                      <ConfirmButton className="btn-danger px-3 py-1.5 text-[13px]" message="Ta bort räkenskapsåret?">
                        Ta bort
                      </ConfirmButton>
                    </form>
                  )}
                </div>
              </div>
              {editing === y.id && (
                <form action={action} className="mt-3 grid gap-3 rounded-xl bg-surface-2 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <input type="hidden" name="intent" value="update" />
                  <input type="hidden" name="id" value={y.id} />
                  <div>
                    <label className="label" htmlFor={`s${y.id}`}>Första dag</label>
                    <input id={`s${y.id}`} type="date" name="start" defaultValue={y.start} readOnly={!isFirst} className="input read-only:opacity-60" />
                  </div>
                  <div>
                    <label className="label" htmlFor={`e${y.id}`}>Sista dag</label>
                    <input id={`e${y.id}`} type="date" name="end" defaultValue={y.end} readOnly={!isLast} className="input read-only:opacity-60" />
                  </div>
                  <ConfirmButton>Spara</ConfirmButton>
                  <p className="text-[12px] text-muted sm:col-span-3">
                    Ett räkenskapsår är normalt 12 månader. Det första året får förlängas eller förkortas, men högst till 18 månader. Det måste börja den 1:a och sluta sista dagen i en månad.
                  </p>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Message state={state} />
        <form action={action} className="ml-auto">
          <input type="hidden" name="intent" value="add" />
          <ConfirmButton className="btn-secondary">Lägg till nästa räkenskapsår</ConfirmButton>
        </form>
      </div>
    </div>
  );
}
