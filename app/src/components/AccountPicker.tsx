"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

type Account = { number: number; name: string };

/**
 * Kontoväljare som söker på både nummer och namn ("hyra" → 5010 Lokalhyra).
 * Tangentbord: pil upp/ned, Enter för att välja, Escape för att stänga.
 */
export function AccountPicker({ accounts, value, onChange, label = "Konto" }: { accounts: Account[]; value: string; onChange: (v: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Listan placeras fast i fönstret så att den inte klipps av tabellens rullbara behållare.
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const place = () => {
    const r = input.current?.getBoundingClientRect();
    if (!r) return;
    const up = r.bottom + 300 > window.innerHeight && r.top > 300;
    setPos({ top: up ? r.top - 4 : r.bottom + 4, left: Math.min(r.left, window.innerWidth - 330), up });
  };
  const listId = useId();

  const shown = query ?? value;
  const matches = useMemo(() => {
    const q = (query ?? "").trim().toLowerCase();
    if (!q) return accounts.slice(0, 60);
    const isNum = /^\d+$/.test(q);
    return accounts
      .filter((a) => (isNum ? String(a.number).startsWith(q) : a.name.toLowerCase().includes(q) || String(a.number).startsWith(q)))
      .sort((a, b) => {
        // Namn som börjar med söktexten först
        const sa = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const sb = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return sa - sb || a.number - b.number;
      })
      .slice(0, 60);
  }, [accounts, query]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(null);
      }
    };
    const hide = () => {
      setOpen(false);
      setQuery(null);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", hide);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    place();
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open]);

  const pick = (a: Account) => {
    onChange(String(a.number));
    setQuery(null);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={shown}
        placeholder="Sök…"
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setQuery(null);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
          // Ett komplett kontonummer kan skrivas direkt.
          if (/^\d{4}$/.test(e.target.value) && accounts.some((a) => String(a.number) === e.target.value)) onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && open && matches[active]) {
            e.preventDefault();
            pick(matches[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery(null);
          }
        }}
        className="input"
      />
      {open && pos && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          style={{ top: pos.top, left: pos.left, transform: pos.up ? "translateY(-100%)" : undefined }}
          className="fixed z-50 max-h-72 w-80 overflow-y-auto rounded-xl bg-surface p-1 shadow-2xl ring-1 ring-line"
        >
          {matches.map((a, i) => (
            <li
              key={a.number}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(a);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer gap-3 rounded-lg px-2.5 py-1.5 text-[14px] ${i === active ? "bg-brand text-white" : ""}`}
            >
              <span className="w-10 shrink-0 font-semibold tabular-nums">{a.number}</span>
              <span className={`truncate ${i === active ? "text-white/90" : "text-muted"}`}>{a.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
