"use client";

import { useActionState } from "react";
import { createResetLink, type ResetState } from "@/app/(app)/admin/actions";

export function ResetLinkForm({ userId }: { userId: number }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(createResetLink, undefined);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="userId" value={userId} />
      <button className="text-[13px] text-brand hover:underline" disabled={pending}>
        {pending ? "Skapar…" : "Återställningslänk"}
      </button>
      {state?.error && <p className="mt-1 text-[12px] text-danger">{state.error}</p>}
      {state?.link && (
        <div className="mt-2 max-w-xs rounded-lg bg-warn-soft p-2 text-[12px] text-warn">
          <p className="mb-1">Länken för {state.email} gäller i 24 timmar och visas bara nu. Skicka den till användaren på ett säkert sätt.</p>
          <input readOnly value={state.link} onFocus={(e) => e.currentTarget.select()} className="input w-full text-[12px]" />
        </div>
      )}
    </form>
  );
}
