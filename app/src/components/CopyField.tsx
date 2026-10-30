"use client";

import { useState } from "react";

export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex w-full min-w-0 gap-2">
      <input readOnly value={value} aria-label="Adress" className="input min-w-0 flex-1 font-mono text-[13px]" onFocus={(e) => e.target.select()} />
      <button
        type="button"
        className="btn-secondary shrink-0"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        }}
      >
        {copied ? "Kopierad" : "Kopiera"}
      </button>
    </div>
  );
}
