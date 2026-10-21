"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReceiptData } from "@/lib/receipt-ai";
import { bookTemplateAction } from "@/app/(app)/verifications/book-actions";
import { templateLines, type Country } from "@/lib/template-lines";
import type { Uploaded } from "@/lib/upload-client";
import { ConfirmButton } from "./ConfirmButton";
import { FileUploader } from "./FileUploader";
import { Icon } from "./Icon";
import { Segmented } from "./SegmentedButtons";
import { VerificationEditor, type Row } from "./VerificationEditor";

export type WizardTemplate = {
  id: number;
  name: string;
  category: string;
  description: string;
  keywords: string;
  costAccount: number;
  vatRate: number;
  vatAccount: number | null;
  direction: string;
  usageCount: number;
};

const toOre = (s: string) => Math.round(Number(s.replace(/\s/g, "").replace(",", ".")) * 100) || 0;
const fmt = (ore: number) => (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s: string) => s.toLowerCase();
const words = (s: string) => norm(s).split(/[^a-z0-9åäöéü]+/i).filter(Boolean);

/** Kort ord måste börja ett ord ("tåg" → "tågbiljett"), längre ord får finnas inuti sammansatta ord. */
function hits(query: string, hay: string) {
  const hw = words(hay);
  return words(query).filter((q) => q.length >= 2 && hw.some((w) => w.startsWith(q) || (q.length >= 5 && w.includes(q)))).length;
}

const PAY_ACCOUNTS: [string, string][] = [
  ["1930", "1930 – Företagskonto / affärskonto"],
  ["1910", "1910 – Kassa"],
  ["2893", "2893 – Privat (lån från ägare)"],
  ["2890", "2890 – Utlägg (skuld till anställd)"],
  ["2440", "2440 – Leverantörsskuld (obetald faktura)"],
];

const STEPS = ["Välj mall", "Fyll i detaljer", "Granska"];

function TemplateList({ items, onPick, empty }: { items: WizardTemplate[]; onPick: (t: WizardTemplate) => void; empty?: string }) {
  if (items.length === 0) return <p className="px-1 py-6 text-center text-[14px] text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
      {items.map((t) => (
        <li key={t.id}>
          <button type="button" onClick={() => onPick(t)} className="flex w-full items-center gap-3 bg-surface px-4 py-3 text-left transition hover:bg-surface-2">
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">{t.name}</span>
              {t.description && <span className="mt-0.5 line-clamp-3 block text-[13px] text-muted">{t.description}</span>}
            </span>
            <span aria-hidden className="text-[20px] text-muted">›</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function BookingWizard({
  templates,
  accounts,
  noVat,
  manualAction,
  uploader,
  presetUploadIds,
  back,
  allowManual = true,
  ai = false,
  presetAi = null,
}: {
  templates: WizardTemplate[];
  accounts: { number: number; name: string }[];
  noVat: boolean;
  manualAction: (fd: FormData) => Promise<void>;
  /** Visar "Lägg till underlag" bredvid guiden. */
  uploader?: { blob: boolean; limit?: number | null; companyId: number };
  /** Underlag som redan är valt (t.ex. när man bokför från Uppladdat). */
  presetUploadIds?: number[];
  back: string;
  allowManual?: boolean;
  /** AI-avläsning av kvitton är aktiverad (OpenRouter). */
  ai?: boolean;
  /** Redan avläst data för förvalt underlag. */
  presetAi?: ReceiptData | null;
}) {
  const [step, setStep] = useState(1);
  const [tab, setTab] = useState<"search" | "all" | "manual">("search");
  const [query, setQuery] = useState("");
  const [tpl, setTpl] = useState<WizardTemplate | null>(null);
  const [gross, setGross] = useState("");
  const [country, setCountry] = useState<Country>("se");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [pay, setPay] = useState("1930");
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [attachments, setAttachments] = useState<Uploaded[]>([]);
  const [editRows, setEditRows] = useState<Row[] | null>(null);
  const names = useMemo(() => new Map(accounts.map((a) => [a.number, a.name])), [accounts]);
  const [aiState, setAiState] = useState<"idle" | "reading" | "done" | "error">("idle");
  const [aiError, setAiError] = useState("");
  const [aiData, setAiData] = useState<ReceiptData | null>(null);

  /** Fyller i guiden med det AI:n läst av. Mallen väljs om AI:n hittade en, annars blir beskrivningen en sökning. */
  const applyAi = useCallback(
    (d: ReceiptData) => {
      setAiData(d);
      setAiState("done");
      const t = templates.find((x) => x.id === d.templateId) ?? null;
      if (d.total && d.currency === "SEK") setGross(d.total.toFixed(2).replace(".", ","));
      if (d.date) setDate(d.date);
      setCountry(d.country === "EU" ? "eu" : d.country === "OUTSIDE_EU" ? "world" : "se");
      const label = [d.supplier, d.description].filter(Boolean).join(" – ");
      if (t) {
        setTpl(t);
        setTitle(label || t.name);
        setStep(2);
      } else {
        setTitle(label);
        setQuery(d.description || d.supplier || "");
      }
    },
    [templates],
  );

  const readAi = useCallback(
    async (uploadId: number) => {
      setAiState("reading");
      setAiError("");
      try {
        const res = await fetch(`/api/receipts/${uploadId}/read`, { method: "POST" });
        const j = (await res.json()) as { status: string; data?: ReceiptData; error?: string };
        if (j.status === "done" && j.data) applyAi(j.data);
        else if (j.status === "disabled") setAiState("idle");
        else {
          setAiState("error");
          setAiError(j.error ?? "Avläsningen misslyckades.");
        }
      } catch {
        setAiState("error");
        setAiError("Kunde inte nå servern.");
      }
    },
    [applyAi],
  );

  // Förvalt underlag (från Uppladdat): använd sparad avläsning eller läs av direkt.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (presetAi) applyAi(presetAi);
    else if (ai && presetUploadIds?.length) void readAi(presetUploadIds[0]);
  }, [ai, presetAi, presetUploadIds, applyAi, readAi]);

  const popular = useMemo(() => [...templates].sort((a, b) => b.usageCount - a.usageCount).slice(0, 6), [templates]);
  const searched = useMemo(() => {
    if (!query.trim()) return [];
    return templates
      .map((t) => ({ t, score: hits(query, t.name) * 3 + hits(query, `${t.keywords} ${t.category}`) * 2 + hits(query, `${t.description} ${names.get(t.costAccount) ?? ""}`) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.t.usageCount - a.t.usageCount)
      .map((x) => x.t);
  }, [query, templates, names]);
  const byCategory = useMemo(() => {
    const m = new Map<string, WizardTemplate[]>();
    for (const t of [...templates].sort((a, b) => a.name.localeCompare(b.name, "sv"))) m.set(t.category, [...(m.get(t.category) ?? []), t]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "sv"));
  }, [templates]);

  const isSale = tpl?.direction === "sale";
  const showCountry = !!tpl && !isSale && !noVat && tpl.direction !== "reverse";
  const amount = toOre(gross);
  const lines = tpl && amount > 0 ? templateLines(tpl, amount, { country, payAccount: Number(pay), noVat }) : [];
  const reverse = !!tpl && !isSale && !noVat && (tpl.direction === "reverse" || country !== "se");
  const uploadIds = [...(presetUploadIds ?? []), ...attachments.map((a) => a.id)];

  const pick = (t: WizardTemplate) => {
    setTpl(t);
    setTitle(t.name);
    setCountry("se");
    setStep(2);
  };

  // Manuellt läge: hela debet/kredit-redigeraren (ev. förifylld från granskningen).
  if (tab === "manual" && allowManual) {
    return (
      <div className="space-y-4">
        <Segmented value={tab} onChange={(v) => setTab(v as typeof tab)} items={[["search", "Sök"], ["all", "Alla mallar"], ["manual", "Manuell"]]} />
        <VerificationEditor
          key={editRows ? "edit" : "blank"}
          accounts={accounts}
          action={manualAction}
          uploader={uploader}
          initialRows={editRows ?? undefined}
          initialAttachments={attachments}
          defaults={{ description: title || undefined, date, uploadId: presetUploadIds?.[0] }}
        />
      </div>
    );
  }

  const main = (
    <div className="min-w-0 space-y-5">
      {/* Steg och förlopp */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          {step > 1 && (
            <button type="button" onClick={() => setStep(step - 1)} className="grid h-8 w-8 place-items-center rounded-full bg-fill text-[18px] hover:bg-fill-hover" aria-label="Tillbaka">
              ‹
            </button>
          )}
          <h2 className="text-[22px] font-semibold tracking-[-0.02em]">{STEPS[step - 1]}</h2>
          <span className="ml-auto text-[13px] text-muted">Steg {step} av 3</span>
        </div>
        <div className="flex gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s} className={`h-1.5 flex-1 rounded-full transition ${i < step ? "bg-brand" : "bg-fill"}`} />
          ))}
        </div>
      </div>

      {aiState === "reading" && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-brand-soft px-4 py-3 text-[14px] font-medium text-brand">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden /> Läser av kvittot med AI…
        </p>
      )}
      {aiState === "error" && <p className="rounded-xl bg-warn-soft px-4 py-3 text-[14px] text-warn">AI-avläsningen misslyckades: {aiError} Fyll i uppgifterna själv.</p>}

      {step === 1 && (
        <div className="space-y-4">
          <Segmented value={tab} onChange={(v) => setTab(v as typeof tab)} items={allowManual ? [["search", "Sök"], ["all", "Alla mallar"], ["manual", "Manuell"]] : [["search", "Sök"], ["all", "Alla mallar"]]} />
          {tab === "search" && (
            <>
              <div className="relative">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Vad betalade du för? T.ex. telefon, hotell, dator"
                  className="input pr-10"
                  aria-label="Sök mall"
                />
                <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="m16 16 4 4" strokeLinecap="round" />
                </svg>
              </div>
              <p className="text-[13px] font-semibold text-muted">{query.trim() ? "Mallar som matchar" : "Dina vanligaste mallar"}</p>
              <TemplateList
                items={query.trim() ? searched : popular}
                onPick={pick}
                empty="Ingen mall matchar. Prova ett annat ord, bläddra bland alla mallar eller bokför manuellt."
              />
            </>
          )}
          {tab === "all" && (
            <div className="space-y-5">
              {byCategory.map(([cat, list]) => (
                <section key={cat}>
                  <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{cat}</h3>
                  <TemplateList items={list} onPick={pick} />
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 2 && tpl && (
        <div className="space-y-4">
          <div className="rounded-xl bg-brand-soft p-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">{tpl.name}</p>
                {tpl.description && <p className="mt-0.5 text-[13px] text-ink/80">{tpl.description}</p>}
              </div>
              <button type="button" onClick={() => setStep(1)} className="shrink-0 text-[13px] font-medium text-brand">
                Byt mall
              </button>
            </div>
          </div>

          {aiData && (
            <div className="rounded-xl bg-success-soft px-4 py-3 text-[13px] text-success">
              <p className="font-semibold">
                <Icon name="wand" className="mr-1 inline h-4 w-4" />
                Avläst med AI{aiData.supplier ? ` – ${aiData.supplier}` : ""} · kontrollera uppgifterna
              </p>
              {aiData.currency !== "SEK" && aiData.total && (
                <p className="mt-1 text-warn">
                  Kvittot är i {aiData.currency} ({aiData.total.toLocaleString("sv-SE")} {aiData.currency}). Ange summan i kronor enligt kontoutdraget.
                </p>
              )}
              {aiData.vat.length > 0 && (
                <p className="mt-1 text-ink/70">Moms enligt kvittot: {aiData.vat.map((v) => `${v.rate} %: ${v.amount.toLocaleString("sv-SE", { minimumFractionDigits: 2 })}`).join(", ")}</p>
              )}
            </div>
          )}
          <div>
            <label className="label" htmlFor="w-gross">{reverse ? "Summa (utan svensk moms)" : "Summa (inkl. moms)"}</label>
            <input id="w-gross" autoFocus value={gross} onChange={(e) => setGross(e.target.value)} inputMode="decimal" placeholder="0,00" className="input text-right text-[17px]" />
          </div>

          {showCountry && (
            <div>
              <label className="label" htmlFor="w-country">Säljarens land</label>
              <select id="w-country" value={country} onChange={(e) => setCountry(e.target.value as Country)} className="input">
                <option value="se">Sverige</option>
                <option value="eu">Annat EU-land</option>
                <option value="world">Land utanför EU</option>
              </select>
              {country !== "se" && (
                <p className="mt-1 text-[12px] text-muted">
                  Tjänster från {country === "eu" ? "EU" : "utanför EU"} bokförs med omvänd skattskyldighet (konto {country === "eu" ? 4535 : 4531}, 25 % moms som både dras och redovisas).
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between border-y border-line py-3 text-[15px]">
            <span>Total summa</span>
            <span className="font-semibold tabular-nums">{fmt(amount)} kr</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="w-date">Betaldatum</label>
              <input id="w-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="w-pay">{isSale ? "Pengarna kom in på" : "Betalt från"}</label>
              <select id="w-pay" value={pay} onChange={(e) => setPay(e.target.value)} className="input">
                {PAY_ACCOUNTS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="w-title">Titel</label>
            <input id="w-title" value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="w-comment">Kommentar</label>
            <textarea id="w-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Lägg till en kommentar på verifikatet" className="input" />
          </div>
          <button type="button" disabled={amount <= 0 || !date} onClick={() => setStep(3)} className="btn-primary w-full py-2.5">
            Nästa
          </button>
        </div>
      )}

      {step === 3 && tpl && (
        <form action={bookTemplateAction} className="space-y-4">
          <input type="hidden" name="templateId" value={tpl.id} />
          <input type="hidden" name="gross" value={gross} />
          <input type="hidden" name="country" value={country} />
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="payAccount" value={pay} />
          <input type="hidden" name="title" value={title} />
          <input type="hidden" name="comment" value={comment} />
          <input type="hidden" name="uploadIds" value={uploadIds.join(",")} />
          <input type="hidden" name="back" value={back} />

          <div className="rounded-xl bg-surface-2 px-4 py-2.5 text-[13px] font-medium text-muted">Så här kommer ditt verifikat se ut:</div>
          <div>
            <p className="text-[16px] font-semibold">{title || tpl.name}</p>
            <p className="text-[14px] text-muted">{date}</p>
            {comment && <p className="mt-1 text-[13px] text-muted">{comment}</p>}
          </div>
          <div className="overflow-hidden rounded-xl ring-1 ring-line">
            <table className="table">
              <thead>
                <tr>
                  <th>Konto</th>
                  <th className="num">Debet</th>
                  <th className="num">Kredit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <span className="font-medium">{l.account}</span> <span className="text-muted">{names.get(l.account)}</span>
                    </td>
                    <td className="num">{fmt(l.debit)} kr</td>
                    <td className="num">{fmt(l.credit)} kr</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {uploadIds.length === 0 && (
            <p className="flex items-center gap-2 rounded-xl bg-warn-soft px-4 py-2.5 text-[13px] text-warn">
              <Icon name="paperclip" className="h-4 w-4" /> Inget underlag bifogat. Kvitton ska sparas enligt bokföringslagen.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {allowManual && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setEditRows(lines.map((l) => ({ account: String(l.account), debit: l.debit ? fmt(l.debit).replace(/\s/g, "") : "", credit: l.credit ? fmt(l.credit).replace(/\s/g, "") : "", text: "" })));
                  setTab("manual");
                }}
              >
                <Icon name="wand" className="h-4 w-4" /> Redigera verifikat
              </button>
            )}
            <div className="ml-auto">
              <ConfirmButton>Ok, bokför</ConfirmButton>
            </div>
          </div>
        </form>
      )}
    </div>
  );

  if (!uploader) return main;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="card p-5">{main}</div>
      <aside className="card p-5 lg:sticky lg:top-8">
        <h2 className="mb-3 text-[17px] font-semibold">Lägg till underlag</h2>
        {attachments.length > 0 && (
          <ul className="mb-3 space-y-2">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-xl bg-surface-2 p-2">
                <span className="grid h-12 w-10 shrink-0 place-items-center overflow-hidden rounded-md bg-surface text-[10px] text-muted">
                  {a.mimeType.startsWith("image/") && !a.mimeType.includes("hei") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${a.id}`} alt="" className="h-full w-full object-cover" />
                  ) : (
                    "PDF"
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px]">{a.fileName}</span>
                <button type="button" aria-label={`Ta bort ${a.fileName}`} onClick={() => setAttachments(attachments.filter((x) => x.id !== a.id))} className="grid h-7 w-7 place-items-center rounded-full hover:bg-fill">
                  <Icon name="x" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <FileUploader
          blob={uploader.blob}
          limit={uploader.limit}
          companyId={uploader.companyId}
          onUploaded={(f) => {
            setAttachments((p) => [...p, ...f]);
            // Första kvittot läses av automatiskt om ingen mall är vald ännu.
            if (ai && !tpl && f[0]) void readAi(f[0].id);
          }}
        />
        {ai && <p className="mt-3 text-[12px] text-muted">Kvitton läses av automatiskt med AI – summa, datum, moms och mall fylls i.</p>}
      </aside>
    </div>
  );
}
