"use client";

import { useOptimistic, useTransition } from "react";
import { setTheme } from "@/app/(app)/settings/appearance/actions";
import { Icon } from "./Icon";

const OPTIONS = [
  { key: "system", label: "Automatiskt", hint: "Följer enhetens inställning" },
  { key: "light", label: "Ljust", hint: "Alltid ljust" },
  { key: "dark", label: "Mörkt", hint: "Alltid mörkt" },
] as const;

/** Miniatyr av appen i ljust/mörkt läge, som macOS Utseende-inställning. */
function Preview({ mode }: { mode: "light" | "dark" | "system" }) {
  const pane = (dark: boolean) => (
    <div className={`flex h-full flex-1 ${dark ? "bg-[#1c1c1e]" : "bg-[#f5f5f7]"}`}>
      <div className={`w-[28%] space-y-1 p-1.5 ${dark ? "bg-[#2c2c2e]" : "bg-white/70"}`}>
        <div className="h-1.5 w-3/4 rounded-full bg-[#0a84ff]" />
        <div className={`h-1.5 w-2/3 rounded-full ${dark ? "bg-white/20" : "bg-black/10"}`} />
        <div className={`h-1.5 w-1/2 rounded-full ${dark ? "bg-white/20" : "bg-black/10"}`} />
      </div>
      <div className="flex-1 space-y-1.5 p-2">
        <div className={`h-2 w-1/2 rounded-full ${dark ? "bg-white/70" : "bg-black/70"}`} />
        <div className={`h-6 rounded-md ${dark ? "bg-[#2c2c2e]" : "bg-white"}`} />
        <div className={`h-6 rounded-md ${dark ? "bg-[#2c2c2e]" : "bg-white"}`} />
      </div>
    </div>
  );
  return (
    <div className="flex h-24 w-full overflow-hidden rounded-xl ring-1 ring-black/10">
      {mode === "system" ? (
        <>
          <div className="w-1/2 overflow-hidden">{pane(false)}</div>
          <div className="w-1/2 overflow-hidden">{pane(true)}</div>
        </>
      ) : (
        pane(mode === "dark")
      )}
    </div>
  );
}

export function ThemePicker({ current }: { current: string }) {
  const [optimistic, setOptimistic] = useOptimistic(current);
  const [pending, start] = useTransition();

  return (
    <div role="radiogroup" aria-label="Utseende" className="grid gap-4 sm:grid-cols-3">
      {OPTIONS.map((o) => {
        const on = optimistic === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={pending}
            onClick={() =>
              start(async () => {
                setOptimistic(o.key);
                // Uppdatera direkt i webbläsaren innan servern svarat.
                if (o.key === "system") document.documentElement.removeAttribute("data-theme");
                else document.documentElement.setAttribute("data-theme", o.key);
                await setTheme(o.key);
              })
            }
            className={`rounded-2xl p-3 text-left transition ${on ? "bg-brand-soft ring-2 ring-brand" : "bg-surface-2 hover:bg-fill"}`}
          >
            <Preview mode={o.key} />
            <span className="mt-3 flex items-center gap-2 text-[15px] font-semibold">
              <span className={`grid h-5 w-5 place-items-center rounded-full ${on ? "bg-brand text-white" : "ring-1 ring-line"}`}>
                {on && <Icon name="check" className="h-3.5 w-3.5" />}
              </span>
              {o.label}
            </span>
            <span className="mt-0.5 block pl-7 text-[13px] text-muted">{o.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
