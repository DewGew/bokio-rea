"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { sieImportAction } from "@/app/(app)/settings/import-export/actions";
import { Icon } from "./Icon";

const ACTION_TEXT = {
  use: "Importeras till det befintliga räkenskapsåret",
  "create-before": "Ett nytt räkenskapsår skapas före ditt första år",
  "create-after": "Ett nytt räkenskapsår skapas efter ditt senaste år",
  "replace-empty": "Ditt tomma räkenskapsår får filens datum",
} as const;

function Option({ name, label, hint, checked, onChange, disabled }: { name: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 rounded-xl bg-surface-2 p-3 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input type="checkbox" name={name} checked={checked && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]" />
      <span>
        <span className="block text-[15px] font-medium">{label}</span>
        <span className="text-[13px] text-muted">{hint}</span>
      </span>
    </label>
  );
}

export function SieImporter() {
  const [state, dispatch, pending] = useActionState(sieImportAction, undefined);
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [opts, setOpts] = useState({ accounts: true, ib: true, vers: true, vat: false, close: false });

  const plan = state?.step === "plan" ? state.plan : null;
  // Föreslå rimliga val när filen analyserats.
  useEffect(() => {
    if (!plan) return;
    const ended = new Date(plan.file.end) < new Date();
    setOpts({
      accounts: true,
      ib: plan.fiscalYear.isFirst && plan.ibBalanced && plan.counts.ibAccounts > 0,
      vers: plan.counts.verifications > 0,
      vat: ended,
      close: false,
    });
  }, [plan]);

  const send = (confirm: boolean, f = file) => {
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    if (confirm) {
      fd.append("confirm", "1");
      if (opts.accounts) fd.append("optAccounts", "on");
      if (opts.ib) fd.append("optIb", "on");
      if (opts.vers) fd.append("optVers", "on");
      if (opts.vat) fd.append("optVat", "on");
      if (opts.close) fd.append("optClose", "on");
    }
    startTransition(() => dispatch(fd));
  };

  if (state?.step === "done") {
    const r = state.result;
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl bg-success-soft p-4 text-success">
          <Icon name="check" className="mt-0.5 h-5 w-5" />
          <div className="text-[15px]">
            <p className="font-semibold">Importen är klar – räkenskapsår {r.fiscalYear}</p>
            <p>
              {r.verifications} verifikat, {r.ibLines} ingående balanser, {r.accountsCreated} nya konton
              {r.lockedVat ? `, ${r.lockedVat} momsperioder markerade som redovisade` : ""}
              {r.closed ? ", året är stängt" : ""}.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/verifications" className="btn-secondary">Visa verifikat</Link>
          <Link href="/reports/balance" className="btn-secondary">Balansrapport</Link>
          <button
            className="btn-secondary"
            onClick={() => {
              setFile(null);
              const fd = new FormData();
              fd.append("reset", "1");
              startTransition(() => dispatch(fd));
            }}
          >
            Importera fler år
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-dashed border-line p-5">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-soft text-brand">
          <Icon name="upload" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">{file ? file.name : "Välj en SIE-fil"}</p>
          <p className="text-[13px] text-muted">{pending ? "Läser in…" : "SIE typ 4 (.se/.si) från Fortnox, Visma, Bokio eller annat bokföringsprogram"}</p>
        </div>
        <button type="button" className="btn-secondary" disabled={pending} onClick={() => input.current?.click()}>
          {file ? "Byt fil" : "Välj fil"}
        </button>
        <input
          ref={input}
          type="file"
          accept=".se,.si,.sie,text/plain"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f) send(false, f);
            e.target.value = "";
          }}
        />
      </div>

      {state?.step === "error" && <p role="alert" className="rounded-xl bg-danger-soft p-3 text-[14px] font-medium text-danger">{state.error}</p>}

      {plan && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-surface-2 p-4 text-[14px]">
              <p className="text-[12px] font-medium text-muted">Från filen</p>
              <p className="mt-1 font-semibold">{plan.file.companyName || "Okänt företag"}</p>
              <p className="text-muted">
                {plan.file.orgNumber} · {plan.file.program.replace(/"/g, "") || "okänt program"}
              </p>
              <p className="mt-2">
                Räkenskapsår <strong>{plan.file.year}</strong> ({plan.file.start} – {plan.file.end})
              </p>
              <p className="text-muted">{ACTION_TEXT[plan.fiscalYear.action]}.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[14px]">
              {(
                [
                  ["Verifikat", plan.counts.verifications],
                  ["Transaktioner", plan.counts.transactions],
                  ["Ingående balanser", plan.counts.ibAccounts],
                  ["Nya konton", plan.counts.newAccounts],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-xl bg-surface-2 p-3">
                  <p className="text-[12px] text-muted">{k}</p>
                  <p className="text-[20px] font-semibold tabular-nums">{v}</p>
                </div>
              ))}
            </div>
          </div>

          {plan.errors.map((e) => (
            <p key={e} role="alert" className="rounded-xl bg-danger-soft p-3 text-[14px] font-medium text-danger">
              {e}
            </p>
          ))}
          {plan.unbalanced.length > 0 && (
            <p className="text-[13px] text-muted">
              Obalanserade verifikat: {plan.unbalanced.map((u) => `${u.series}${u.number ?? ""} (${(u.diff / 100).toFixed(2)} kr)`).join(", ")}
            </p>
          )}
          {plan.warnings.map((w) => (
            <p key={w} className="rounded-xl bg-warn-soft p-3 text-[14px] text-warn">
              {w}
            </p>
          ))}

          {plan.errors.length === 0 && (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <Option name="optAccounts" label="Kontoplan" hint={`Konton som saknas läggs till (${plan.counts.newAccounts} st). Befintliga behåller sina namn.`} checked={opts.accounts} onChange={(v) => setOpts({ ...opts, accounts: v })} />
                <Option
                  name="optIb"
                  label="Ingående balanser"
                  hint={plan.fiscalYear.isFirst ? "Saldona vid årets början." : "Bara för första räkenskapsåret – senare år får dem från bokslutet."}
                  checked={opts.ib}
                  disabled={!plan.fiscalYear.isFirst || !plan.ibBalanced || plan.counts.ibAccounts === 0}
                  onChange={(v) => setOpts({ ...opts, ib: v })}
                />
                <Option
                  name="optVers"
                  label="Verifikat"
                  hint={`${plan.counts.verifications} verifikat med originalserie (${plan.counts.series.join(", ") || "–"}) och nummer.`}
                  checked={opts.vers}
                  disabled={plan.counts.verifications === 0}
                  onChange={(v) => setOpts({ ...opts, vers: v })}
                />
                <Option name="optVat" label="Momsen är redan redovisad" hint="Markerar årets momsperioder som deklarerade och låsta." checked={opts.vat} onChange={(v) => setOpts({ ...opts, vat: v })} />
                <Option name="optClose" label="Stäng räkenskapsåret" hint="Om bokslutet redan är gjort i det gamla programmet." checked={opts.close} onChange={(v) => setOpts({ ...opts, close: v })} />
              </div>
              <div className="flex justify-end">
                <button type="button" className="btn-primary" disabled={pending} onClick={() => send(true)}>
                  {pending ? "Importerar…" : `Importera ${plan.file.year}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
