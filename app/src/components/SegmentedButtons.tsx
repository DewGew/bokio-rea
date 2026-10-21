"use client";

/** Segmenterad kontroll med knappar (för lokalt tillstånd; länkvarianten finns i ui.tsx). */
export function Segmented({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: [string, string][] }) {
  return (
    <div role="tablist" className="segmented">
      {items.map(([key, label]) => (
        <button key={key} type="button" role="tab" aria-selected={value === key} aria-current={value === key ? "page" : undefined} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}
