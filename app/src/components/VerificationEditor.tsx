"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Uploaded } from "@/lib/upload-client";
import type { Suggestion } from "@/lib/suggest";
import { calculateTemplateLines } from "@/lib/flexible-template-lines";
import { AccountPicker } from "./AccountPicker";
import { ConfirmButton } from "./ConfirmButton";
import { FileUploader } from "./FileUploader";
import { Icon } from "./Icon";

export type Row = { account: string; debit: string; credit: string; text: string };
const empty = (): Row => ({ account: "", debit: "", credit: "", text: "" });

function toOre(s: string) {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
const fmt = (ore: number) => (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plain = (ore: number) => (ore / 100).toFixed(2).replace(".", ",");

const OUTPUT_VAT: Record<number, number> = { 25: 2611, 12: 2621, 6: 2631 };
const SOURCE_LABEL: Record<Suggestion["source"], string> = { history: "Tidigare", template: "Mall", keyword: "Förslag", account: "Konto" };
const PAY_ACCOUNTS: [string, string][] = [
  ["1930", "Företagskontot (1930)"],
  ["1910", "Kassa (1910)"],
  ["2018", "Egen insättning (2018)"],
  ["2893", "Privat – lån från ägare (2893)"],
  ["2890", "Utlägg – skuld till anställd (2890)"],
  ["2440", "Obetald leverantörsfaktura (2440)"],
];

/** Konteringsrader för ett förslag. Utan belopp fylls bara kontona i. */
function linesFor(s: Suggestion, gross: number, pay: number): Row[] {
  const row = (account: number, ore: number): Row => ({
    account: String(account),
    debit: gross && ore > 0 ? plain(ore) : "",
    credit: gross && ore < 0 ? plain(-ore) : "",
    text: "",
  });
  let parts: [number, number][];
  if (Array.isArray(s.templateLines) && s.templateLines.length > 0) {
    const calculated = calculateTemplateLines({ lines: s.templateLines, costAccount: s.account, vatRate: s.vatRate, vatAccount: null, direction: s.direction }, gross, { payAccount: pay });
    return calculated.map(l => ({ account: String(l.account), debit: gross ? (l.debit ? plain(l.debit) : "") : "", credit: gross ? (l.credit ? plain(l.credit) : "") : "", text: l.text ?? "" })).concat([empty()]);
  } else if (s.pattern) {
    // Samma kontering som tidigare, skalad till det nya beloppet. Öresavrundning läggs på största kreditraden.
    parts = s.pattern.map((p) => [p.account, Math.round(p.share * gross)]);
    const rest = parts.reduce((x, [, v]) => x + v, 0);
    if (rest) {
      const i = parts.reduce((best, [, v], j) => (v < parts[best][1] ? j : best), 0);
      parts[i][1] -= rest;
    }
    if (!gross) return s.pattern.map((p) => ({ account: String(p.account), debit: "", credit: "", text: "" }));
  } else if (s.direction === "sale") {
    const vat = s.vatRate ? Math.round((gross * s.vatRate) / (100 + s.vatRate)) : 0;
    parts = [[pay, gross], [s.account, -(gross - vat)]];
    if (s.vatRate) parts.push([OUTPUT_VAT[s.vatRate] ?? 2611, -vat]);
  } else if (s.direction === "reverse") {
    const vat = Math.round((gross * s.vatRate) / 100);
    parts = [[s.account, gross], [2645, vat], [2614, -vat], [pay, -gross]];
  } else {
    const vat = s.vatRate ? Math.round((gross * s.vatRate) / (100 + s.vatRate)) : 0;
    parts = [[s.account, gross - vat]];
    if (s.vatRate) parts.push([2641, vat]);
    parts.push([pay, -gross]);
  }
  // Utan belopp: behåll alla konton (även momsraden) så att användaren ser konteringen.
  return parts.map(([a, v]) => row(a, v));
}

export function VerificationEditor({
  accounts,
  action,
  defaults,
  uploader,
  initialRows,
  initialAttachments,
}: {
  accounts: { number: number; name: string }[];
  action: (fd: FormData) => Promise<void>;
  defaults?: { date?: string; description?: string; uploadId?: number };
  /** Visar en sektion för att bifoga underlag (foto eller PDF) direkt i verifikatet. */
  uploader?: { blob: boolean; limit?: number | null; companyId: number };
  /** Förifyllda rader, t.ex. från bokföringsguidens "Redigera verifikat". */
  initialRows?: Row[];
  initialAttachments?: Uploaded[];
}) {
  const [rows, setRows] = useState<Row[]>(initialRows?.length ? [...initialRows, empty()] : [empty(), empty(), empty()]);
  const [attachments, setAttachments] = useState<Uploaded[]>(initialAttachments ?? []);
  const [problem, setProblem] = useState("");
  const [desc, setDesc] = useState(defaults?.description ?? "");
  const [gross, setGross] = useState("");
  const [pay, setPay] = useState("1930");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [applied, setApplied] = useState<Suggestion | null>(null);
  const typed = useRef(false);
  const names = useMemo(() => new Map(accounts.map((a) => [String(a.number), a.name])), [accounts]);
  const debit = rows.reduce((s, r) => s + toOre(r.debit), 0);
  const credit = rows.reduce((s, r) => s + toOre(r.credit), 0);
  const diff = debit - credit;

  // Hämta förslag medan man skriver beskrivningen (med en kort fördröjning).
  useEffect(() => {
    if (!typed.current) return;
    const q = desc.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) setSuggestions(((await res.json()) as { suggestions: Suggestion[] }).suggestions);
      } catch {
        // avbrutet eller nätverksfel – inga förslag
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [desc]);

  const apply = (s: Suggestion, amount = gross, payAccount = pay) => {
    setApplied(s);
    setRows([...linesFor(s, toOre(amount), Number(payAccount)), empty()]);
  };

  const set = (i: number, patch: Partial<Row>) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    if (i === rows.length - 1 && (patch.account || patch.debit || patch.credit)) next.push(empty());
    setRows(next);
  };

  /** Fyll i differensen på raden så att verifikatet balanserar. */
  const balance = (i: number) => {
    const r = rows[i];
    const rest = diff - (toOre(r.debit) - toOre(r.credit));
    set(i, rest > 0 ? { credit: plain(rest), debit: "" } : { debit: plain(-rest), credit: "" });
  };

  return (
    <form
      action={action}
      className="space-y-5"
      onSubmit={(e) => {
        const msg =
          debit === 0
            ? "Fyll i minst en debet- och en kreditrad."
            : diff !== 0
              ? `Verifikatet balanserar inte, differens ${fmt(diff)}.`
              : rows.some((r) => (r.debit || r.credit) && !names.has(r.account))
                ? "Någon rad har ett konto som inte finns."
                : "";
        setProblem(msg);
        if (msg) e.preventDefault();
      }}
    >
      <input type="hidden" name="lines" value={JSON.stringify(rows)} />
      {defaults?.uploadId && <input type="hidden" name="uploadId" value={defaults.uploadId} />}
      <input type="hidden" name="uploadIds" value={attachments.map((a) => a.id).join(",")} />

      <div className="grid gap-4 sm:grid-cols-[170px_minmax(0,1fr)] lg:grid-cols-[170px_minmax(0,1fr)_170px_220px]">
        <div>
          <label className="label" htmlFor="date">Datum</label>
          <input id="date" type="date" name="date" required defaultValue={defaults?.date ?? new Date().toISOString().slice(0, 10)} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="description">Vad gäller det?</label>
          <input
            id="description"
            name="description"
            required
            value={desc}
            autoComplete="off"
            onChange={(e) => {
              typed.current = true;
              setDesc(e.target.value);
            }}
            placeholder="T.ex. Telia mobil oktober, lunch med kund, Adobe"
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="gross">Belopp inkl. moms</label>
          <input
            id="gross"
            value={gross}
            inputMode="decimal"
            placeholder="0,00"
            onChange={(e) => {
              setGross(e.target.value);
              if (applied) apply(applied, e.target.value);
            }}
            className="input text-right"
          />
        </div>
        <div>
          <label className="label" htmlFor="pay">Betalt från / till</label>
          <select
            id="pay"
            value={pay}
            onChange={(e) => {
              setPay(e.target.value);
              if (applied) apply(applied, gross, e.target.value);
            }}
            className="input"
          >
            {PAY_ACCOUNTS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      {suggestions.length > 0 && (
        <section aria-label="Konteringsförslag" className="-mt-1">
          <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-muted">
            <Icon name="wand" className="h-4 w-4 text-brand" />
            Förslag på kontering – klicka för att fylla i
          </p>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {suggestions.map((s) => {
              const on = applied?.key === s.key;
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => apply(s)}
                    aria-pressed={on}
                    className={`flex w-full items-start gap-3 rounded-xl p-3 text-left transition ${on ? "bg-brand-soft ring-2 ring-brand" : "bg-surface-2 hover:bg-fill"}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold">{s.title}</span>
                      <span className="block truncate text-[12px] text-muted">{s.subtitle}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.source === "history" ? "bg-success-soft text-success" : "bg-fill text-muted"}`}>
                      {SOURCE_LABEL[s.source]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="table table-edit">
          <thead>
            <tr>
              <th className="w-36">Konto</th>
              <th>Benämning / radtext</th>
              <th className="num w-36">Debet</th>
              <th className="num w-36">Kredit</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <AccountPicker accounts={accounts} value={r.account} onChange={(v) => set(i, { account: v })} />
                </td>
                <td>
                  <span className="block truncate text-xs text-muted">{names.get(r.account) ?? (r.account ? "Okänt konto" : "")}</span>
                  <input aria-label="Radtext" value={r.text} onChange={(e) => set(i, { text: e.target.value })} className="input mt-1 py-1" placeholder="Valfri text" />
                </td>
                <td>
                  <input aria-label="Debet" value={r.debit} onChange={(e) => set(i, { debit: e.target.value })} className="input text-right" inputMode="decimal" />
                </td>
                <td>
                  <input aria-label="Kredit" value={r.credit} onChange={(e) => set(i, { credit: e.target.value })} className="input text-right" inputMode="decimal" />
                </td>
                <td>
                  <button type="button" title="Balansera på denna rad" onClick={() => balance(i)} className="text-muted hover:text-brand">=</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="px-3 py-2.5" colSpan={2}>
                Summa {diff !== 0 && <span className="ml-2 font-normal text-danger">Differens {fmt(diff)}</span>}
              </td>
              <td className="num px-3">{fmt(debit)}</td>
              <td className="num px-3">{fmt(credit)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {uploader && (
        <section aria-labelledby="attach-title" className="space-y-3">
          <h3 id="attach-title" className="flex items-center gap-2 text-[15px] font-semibold">
            <Icon name="paperclip" className="h-[18px] w-[18px] text-brand" />
            Underlag
            <span className="font-normal text-muted">(kvitto, faktura eller avtal)</span>
          </h3>
          {attachments.length > 0 && (
            <ul className="flex flex-wrap gap-3">
              {attachments.map((a) => (
                <li key={a.id} className="group relative h-28 w-24 overflow-hidden rounded-xl bg-surface-2">
                  {a.mimeType.startsWith("image/") && !a.mimeType.includes("hei") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${a.id}`} alt={a.fileName} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center text-[11px] text-muted">
                      <Icon name="doc" className="h-7 w-7 text-brand" />
                      <span className="line-clamp-2 break-all">{a.fileName}</span>
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Ta bort ${a.fileName} från verifikatet`}
                    onClick={() => setAttachments(attachments.filter((x) => x.id !== a.id))}
                    className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white opacity-90 hover:opacity-100"
                  >
                    <Icon name="x" className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <FileUploader compact blob={uploader.blob} limit={uploader.limit} companyId={uploader.companyId} onUploaded={(f) => setAttachments((prev) => [...prev, ...f])} />
        </section>
      )}

      <div className="flex items-center justify-end gap-3">
        {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
        <ConfirmButton>Bokför</ConfirmButton>
      </div>
    </form>
  );
}
