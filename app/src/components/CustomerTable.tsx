"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { kr } from "@/lib/money";

type Row = { id: number; name: string; orgNumber: string; email: string; city: string; reference: string; invoices: number; invoiced: number; unpaid: number };

/** Kundlistan med sökning direkt medan man skriver (namn, org.nr, e-post, ort och referens). */
export function CustomerTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return rows;
    const digits = q.replace(/\D/g, "");
    return rows.filter((r) => {
      const hay = `${r.name} ${r.orgNumber} ${r.email} ${r.city} ${r.reference}`.toLowerCase();
      // Org.nr matchar oavsett bindestreck ("5560743089" hittar "556074-3089").
      return words.every((w) => hay.includes(w)) || (digits.length >= 4 && r.orgNumber.replace(/\D/g, "").includes(digits));
    });
  }, [q, rows]);

  return (
    <>
      <div className="px-4 pb-3 pt-4">
        <div className="relative">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Sök på namn, org.nr, e-post eller ort"
            aria-label="Sök kunder"
            className="input pl-10"
          />
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" strokeLinecap="round" />
          </svg>
        </div>
        {q && (
          <p className="mt-2 text-[13px] text-muted">
            {shown.length} av {rows.length} kunder
          </p>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="px-5 py-10 text-center text-[15px] text-muted">Ingen kund matchar &quot;{q}&quot;.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Namn</th>
                <th className="hidden md:table-cell">Org.nr</th>
                <th className="hidden lg:table-cell">E-post</th>
                <th className="hidden sm:table-cell num">Fakturor</th>
                <th className="num">Fakturerat</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} onClick={() => router.push(`/customers/${c.id}`)} className="cursor-pointer">
                  <td>
                    <Link href={`/customers/${c.id}`} className="font-medium hover:text-brand" onClick={(e) => e.stopPropagation()}>
                      {c.name}
                    </Link>
                    {c.unpaid > 0 && <span className="ml-2 whitespace-nowrap rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn">Obetalt {kr(c.unpaid, { decimals: false })}</span>}
                    <span className="block text-[12px] text-muted md:hidden">{c.orgNumber}</span>
                  </td>
                  <td className="hidden md:table-cell">{c.orgNumber}</td>
                  <td className="hidden lg:table-cell">{c.email}</td>
                  <td className="hidden sm:table-cell num">{c.invoices}</td>
                  <td className="num">{kr(c.invoiced)}</td>
                  <td className="text-right">
                    <Link href={`/customers?edit=${c.id}`} onClick={(e) => e.stopPropagation()} className="text-sm text-brand">
                      Ändra
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
