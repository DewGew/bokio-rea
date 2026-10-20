"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/(auth)/actions";
import { ConfirmButton } from "./ConfirmButton";
import { Flash } from "./ui";

/**
 * Formulär som visar valideringsfel utan att tömma fälten.
 * Fälten fylls i igen via defaultValue efter ett fel (lösenord fylls aldrig i igen).
 */
export function ActionForm({
  action,
  submit,
  children,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  submit: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form
      action={formAction}
      className="space-y-5"
      ref={(form) => {
        if (!form || !state?.values) return;
        for (const [k, v] of Object.entries(state.values)) {
          const el = form.elements.namedItem(k);
          if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = v;
        }
      }}
    >
      <Flash error={state?.error} />
      {children}
      <ConfirmButton className="btn-primary w-full">{submit}</ConfirmButton>
    </form>
  );
}
