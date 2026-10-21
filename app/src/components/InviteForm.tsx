"use client";

import { useActionState, useState } from "react";
import { inviteAction } from "@/app/(app)/settings/users/actions";
import { ROLES } from "@/lib/session-config";
import { Icon } from "./Icon";

export function InviteForm({ companyName }: { companyName: string }) {
  const [state, action, pending] = useActionState(inviteAction, undefined);
  const [role, setRole] = useState<"read" | "full">("read");
  const [copied, setCopied] = useState(false);

  if (state && "link" in state) {
    const label = (ROLES[state.role as "read" | "full"] ?? ROLES.read).label.toLowerCase();
    const subject = `Inbjudan till ${companyName} i Huvudbok`;
    const body = `Hej!\n\nDu är inbjuden till ${companyName} i Huvudbok med ${label}.\n\nÖppna länken för att gå med:\n${state.link}\n\nLänken gäller i 14 dagar.`;
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl bg-success-soft p-4 text-success">
          <Icon name="check" className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-[15px]">
            Inbjudan till <strong>{state.email}</strong> är skapad. Skicka länken till personen – den visas bara nu.
          </p>
        </div>
        <input readOnly value={state.link} aria-label="Inbjudningslänk" className="input font-mono text-[13px]" onFocus={(e) => e.target.select()} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={async () => {
              await navigator.clipboard.writeText(state.link);
              setCopied(true);
            }}
          >
            {copied ? "Kopierad" : "Kopiera länk"}
          </button>
          <a className="btn-secondary" href={`mailto:${state.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>
            Skicka med e-post
          </a>
          <a className="btn-secondary" href="/settings/users">
            Klar
          </a>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="invite-email">E-post</label>
        <input id="invite-email" name="email" type="email" required placeholder="revisor@byran.se" className="input" />
      </div>
      <fieldset className="space-y-2">
        <legend className="label">Behörighet</legend>
        {(["read", "full"] as const).map((r) => (
          <label
            key={r}
            className={`flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 transition ${role === r ? "bg-brand-soft ring-brand" : "bg-surface-2 ring-transparent"}`}
          >
            <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="mt-1 h-4 w-4 accent-[var(--brand)]" />
            <span>
              <span className="block text-[15px] font-medium">{ROLES[r].label}</span>
              <span className="text-[13px] text-muted">{ROLES[r].hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {state && "error" in state && (
        <p role="alert" className="rounded-xl bg-danger-soft p-3 text-[14px] font-medium text-danger">
          {state.error}
        </p>
      )}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Skapar…" : "Skapa inbjudan"}
      </button>
    </form>
  );
}
