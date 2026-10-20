"use client";

import { useMemo, useState } from "react";
import type { Uploaded } from "@/lib/upload-client";
import { ConfirmButton } from "./ConfirmButton";
import { FileUploader } from "./FileUploader";
import { Icon } from "./Icon";

type Row = { account: string; debit: string; credit: string; text: string };
const empty = (): Row => ({ account: "", debit: "", credit: "", text: "" });

function toOre(s: string) {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
const fmt = (ore: number) => (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function VerificationEditor({
  accounts,
  action,
  defaults,
  uploader,
}: {
  accounts: { number: number; name: string }[];
  action: (fd: FormData) => Promise<void>;
  defaults?: { date?: string; description?: string; uploadId?: number };
  /** Visar en sektion för att bifoga underlag (foto eller PDF) direkt i verifikatet. */
  uploader?: { blob: boolean; limit?: number | null; companyId: number };
}) {
  const [rows, setRows] = useState<Row[]>([empty(), empty(), empty()]);
  const [attachments, setAttachments] = useState<Uploaded[]>([]);
  const [problem, setProblem] = useState("");
  const names = useMemo(() => new Map(accounts.map((a) => [String(a.number), a.name])), [accounts]);
  const debit = rows.reduce((s, r) => s + toOre(r.debit), 0);
  const credit = rows.reduce((s, r) => s + toOre(r.credit), 0);
  const diff = debit - credit;

  const set = (i: number, patch: Partial<Row>) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    if (i === rows.length - 1 && (patch.account || patch.debit || patch.credit)) next.push(empty());
    setRows(next);
  };

  /** Fyll i differensen på raden så att verifikatet balanserar. */
  const balance = (i: number) => {
    const r = rows[i];
    const rest = diff - (toOre(r.debit) - toOre(r.credit));
    set(i, rest > 0 ? { credit: fmt(rest).replace(/\s/g, ""), debit: "" } : { debit: fmt(-rest).replace(/\s/g, ""), credit: "" });
  };

  return (
    <form
      action={action}
      className="space-y-5"
      onSubmit={(e) => {
        const msg = debit === 0 ? "Fyll i minst en debet- och en kreditrad." : diff !== 0 ? `Verifikatet balanserar inte, differens ${fmt(diff)}.` : rows.some((r) => (r.debit || r.credit) && !names.has(r.account)) ? "Någon rad har ett konto som inte finns." : "";
        setProblem(msg);
        if (msg) e.preventDefault();
      }}
    >
      <input type="hidden" name="lines" value={JSON.stringify(rows)} />
      {defaults?.uploadId && <input type="hidden" name="uploadId" value={defaults.uploadId} />}
      <input type="hidden" name="uploadIds" value={attachments.map((a) => a.id).join(",")} />
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <div>
          <label className="label" htmlFor="date">Datum</label>
          <input id="date" type="date" name="date" required defaultValue={defaults?.date ?? new Date().toISOString().slice(0, 10)} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="description">Beskrivning</label>
          <input id="description" name="description" required defaultValue={defaults?.description} placeholder="T.ex. Inköp av dator" className="input" />
        </div>
      </div>

      <datalist id="accounts">
        {accounts.map((a) => (
          <option key={a.number} value={a.number}>{a.name}</option>
        ))}
      </datalist>

      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="table table-edit">
          <thead>
            <tr>
              <th className="w-32">Konto</th>
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
                  <input list="accounts" aria-label="Konto" value={r.account} onChange={(e) => set(i, { account: e.target.value })} className="input" inputMode="numeric" />
                </td>
                <td>
                  <span className="block text-xs text-muted">{names.get(r.account) ?? (r.account ? "Okänt konto" : "")}</span>
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
