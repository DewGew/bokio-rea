"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { CodesState } from "@/app/(app)/settings/account/mfa/actions";

/** Formulär med en kod som svarar med återställningskoder. Koderna visas bara en gång. */
export function MfaCodesForm({ action, button, hint }: { action: (prev: CodesState, fd: FormData) => Promise<CodesState>; button: string; hint?: string }) {
  const [state, run, pending] = useActionState<CodesState, FormData>(action, undefined);

  if (state?.codes) {
    return (
      <div className="space-y-3 text-[14px]">
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-warn">
          <strong>Spara dessa återställningskoder nu.</strong> De visas bara en gång. Varje kod fungerar en gång om du tappar telefonen.
        </p>
        <ul className="grid grid-cols-2 gap-2 font-mono text-[15px] sm:max-w-sm">
          {state.codes.map((c) => (
            <li key={c} className="rounded-lg border border-line px-3 py-1.5">{c}</li>
          ))}
        </ul>
        <Link href="/settings/account/mfa" className="btn-primary inline-flex">Jag har sparat koderna</Link>
      </div>
    );
  }
  return (
    <form action={run} className="space-y-3 text-[14px]">
      {hint && <p className="text-muted">{hint}</p>}
      <div>
        <label className="label" htmlFor="mfa-code">Kod från appen</label>
        <input id="mfa-code" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={12} className="input w-48 tracking-[0.15em]" />
      </div>
      {state?.error && <p className="text-danger">{state.error}</p>}
      <button className="btn-primary" disabled={pending}>{pending ? "Kontrollerar…" : button}</button>
    </form>
  );
}
