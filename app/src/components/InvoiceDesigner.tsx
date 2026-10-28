"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { saveInvoiceDesign } from "@/app/(app)/invoices/design/actions";
import { COLOR_PRESETS, INVOICE_TEMPLATES, validHex, validSwish, type InvoiceTemplate } from "@/lib/invoice-design";
import { ConfirmButton } from "./ConfirmButton";
import { Icon } from "./Icon";
import { PdfPreview } from "./PdfPreview";

export type DesignValues = {
  template: InvoiceTemplate;
  color: string;
  footer: string;
  swishNumber: string;
  swishQr: boolean;
  paymentLink: string;
  bankgiro: string;
  plusgiro: string;
  showOcr: boolean;
  bankName: string;
  bankAccount: string;
  iban: string;
  bic: string;
  phone: string;
  website: string;
};

/** Miniatyr av respektive mall, ritad med samma färg som fakturan. */
function TemplateThumb({ t, color }: { t: InvoiceTemplate; color: string }) {
  const line = (w: string, c = "bg-black/10") => <div className={`h-1 rounded-full ${c}`} style={{ width: w }} />;
  return (
    <div className="relative aspect-[1/1.3] w-full overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-black/10">
      {t === "modern" && <div className="h-[22%] w-full" style={{ background: color }} />}
      {t === "elegant" && <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: color }} />}
      <div className="space-y-1.5 p-2.5">
        {t === "klassisk" && (
          <>
            <div className="flex justify-between">
              {line("30%", "bg-black/40")}
              <div className="h-1.5 w-[28%] rounded-full" style={{ background: color }} />
            </div>
            <div className="h-0.5 w-full" style={{ background: color }} />
          </>
        )}
        {t === "minimal" && <div className="h-0.5 w-3" style={{ background: color }} />}
        {t === "elegant" && <div className="ml-auto h-2 w-[40%] rounded-sm bg-black/60" />}
        {line("45%")}
        {line("35%")}
        <div className="pt-1" />
        <div className={`h-2 w-full rounded-sm ${t === "modern" ? "" : "bg-black/5"}`} style={t === "modern" ? { background: `${color}22` } : undefined} />
        {line("100%")}
        {line("100%")}
        {line("100%")}
        <div className="flex justify-end pt-1">
          <div className="h-2.5 w-[42%] rounded-sm" style={{ background: t === "minimal" || t === "klassisk" ? "#0002" : t === "elegant" ? `${color}33` : color }} />
        </div>
      </div>
    </div>
  );
}

function Toggle({ name, checked, onChange, label }: { name: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span className="text-[15px]">{label}</span>
      <input type="checkbox" name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="relative h-[31px] w-[51px] shrink-0 rounded-full bg-fill transition peer-checked:bg-[#34c759] peer-focus-visible:ring-4 peer-focus-visible:ring-brand/30 after:absolute after:left-[2px] after:top-[2px] after:h-[27px] after:w-[27px] after:rounded-full after:bg-white after:shadow-md after:transition-transform peer-checked:after:translate-x-5" />
    </label>
  );
}

function Section({ title, icon, children, hint }: { title: string; icon?: Parameters<typeof Icon>[0]["name"]; children: React.ReactNode; hint?: string }) {
  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em]">
        {icon && <Icon name={icon} className="h-5 w-5 text-brand" />}
        {title}
      </h2>
      {hint && <p className="mt-0.5 text-[13px] text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Konverterar en vald bild (PNG, JPEG, WEBP eller SVG) till PNG, max 800 px bred, med bibehållen transparens. */
async function toPng(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Bilden kunde inte läsas. Använd PNG, JPG, WEBP eller SVG."));
      i.src = url;
    });
    const w = img.naturalWidth || 800;
    const h = img.naturalHeight || 300;
    const scale = Math.min(1, 800 / w);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) throw new Error("Bilden kunde inte konverteras.");
    return new File([blob], "logotyp.png", { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function InvoiceDesigner({ initial, hasLogo: initialLogo }: { initial: DesignValues; hasLogo: boolean }) {
  const [v, setV] = useState(initial);
  const set = <K extends keyof DesignValues>(k: K, val: DesignValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const [state, action] = useActionState(saveInvoiceDesign, undefined);
  const [hasLogo, setHasLogo] = useState(initialLogo);
  const [logoVersion, setLogoVersion] = useState(0);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState("");
  const logoInput = useRef<HTMLInputElement>(null);
  const [hexDraft, setHexDraft] = useState(initial.color);

  // Förhandsvisningen uppdateras en stund efter att man slutat ändra, så att PDF:en inte genereras vid varje tangenttryck.
  const query = useMemo(() => {
    const p = new URLSearchParams({
      template: v.template,
      color: v.color,
      footer: v.footer,
      swishNumber: v.swishNumber,
      swishQr: v.swishQr ? "1" : "0",
      paymentLink: v.paymentLink,
      bankgiro: v.bankgiro,
      plusgiro: v.plusgiro,
      showOcr: v.showOcr ? "1" : "0",
      bankName: v.bankName,
      bankAccount: v.bankAccount,    
      iban: v.iban,
      bic: v.bic,
      phone: v.phone,
      website: v.website,
      v: String(logoVersion),
    });
    return p.toString();
  }, [v, logoVersion]);
  const [src, setSrc] = useState(`/api/invoices/preview?${query}`);
  useEffect(() => {
    const t = setTimeout(() => setSrc(`/api/invoices/preview?${query}`), 450);
    return () => clearTimeout(t);
  }, [query]);

  async function uploadLogo(file?: File) {
    if (!file) return;
    setLogoBusy(true);
    setLogoError("");
    try {
      const png = await toPng(file);
      const fd = new FormData();
      fd.append("logo", png);
      const res = await fetch("/api/company/logo", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Uppladdningen misslyckades.");
      setHasLogo(true);
      setLogoVersion((n) => n + 1);
    } catch (e) {
      setLogoError((e as Error).message);
    } finally {
      setLogoBusy(false);
      if (logoInput.current) logoInput.current.value = "";
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    await fetch("/api/company/logo", { method: "DELETE" });
    setHasLogo(false);
    setLogoVersion((n) => n + 1);
    setLogoBusy(false);
  }

  const swishOk = !v.swishNumber || validSwish(v.swishNumber);

  return (
    <form action={action} className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <input type="hidden" name="template" value={v.template} />
      <input type="hidden" name="color" value={v.color} />

      <div className="space-y-5">
        <Section title="Mall" icon="doc" hint="Grundlayouten för alla dina fakturor.">
          <div role="radiogroup" aria-label="Mall" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {INVOICE_TEMPLATES.map((t) => {
              const on = v.template === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set("template", t.key)}
                  className={`rounded-2xl p-2 text-left transition ${on ? "bg-brand-soft ring-2 ring-brand" : "bg-surface-2 hover:bg-fill"}`}
                >
                  <TemplateThumb t={t.key} color={v.color} />
                  <span className="mt-2 block text-[14px] font-semibold">{t.label}</span>
                  <span className="block text-[12px] leading-snug text-muted">{t.description}</span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Färg" icon="palette" hint="Accentfärgen används i sidhuvud, rubriker och summa.">
          <div className="flex flex-wrap items-center gap-2.5">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c.hex}
                type="button"
                title={c.name}
                aria-label={c.name}
                aria-pressed={v.color.toLowerCase() === c.hex}
                onClick={() => {
                  set("color", c.hex);
                  setHexDraft(c.hex);
                }}
                className={`h-8 w-8 rounded-full ring-offset-2 ring-offset-surface transition hover:scale-110 ${v.color.toLowerCase() === c.hex ? "ring-2 ring-brand" : ""}`}
                style={{ background: c.hex }}
              />
            ))}
            <label className="relative ml-1 flex items-center gap-2 rounded-full bg-fill py-1 pl-1 pr-3 text-[13px]" title="Egen färg">
              <input
                type="color"
                value={v.color}
                onChange={(e) => {
                  set("color", e.target.value);
                  setHexDraft(e.target.value);
                }}
                className="h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent p-0"
                aria-label="Välj egen färg"
              />
              <input
                value={hexDraft}
                onChange={(e) => {
                  setHexDraft(e.target.value);
                  if (validHex(e.target.value)) set("color", e.target.value);
                }}
                className="w-[72px] bg-transparent font-mono text-[13px] outline-none"
                aria-label="Färg som hex"
                maxLength={7}
              />
            </label>
          </div>
        </Section>

        <Section title="Logotyp" icon="upload" hint="PNG, JPG, WEBP eller SVG. Transparent bakgrund blir snyggast.">
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid h-20 w-40 place-items-center overflow-hidden rounded-xl bg-[repeating-conic-gradient(#0000000a_0%_25%,transparent_0%_50%)] bg-[length:14px_14px] ring-1 ring-line">
              {hasLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/company/logo?v=${logoVersion}`} alt="Logotyp" className="max-h-16 max-w-36 object-contain" />
              ) : (
                <span className="text-[12px] text-muted">Ingen logotyp</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={logoBusy} onClick={() => logoInput.current?.click()} className="btn-secondary">
                {logoBusy ? "Laddar…" : hasLogo ? "Byt logotyp" : "Ladda upp logotyp"}
              </button>
              {hasLogo && (
                <button type="button" disabled={logoBusy} onClick={removeLogo} className="btn-danger">
                  Ta bort
                </button>
              )}
              <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" tabIndex={-1} onChange={(e) => uploadLogo(e.target.files?.[0])} />
            </div>
          </div>
          {logoError && <p role="alert" className="mt-2 text-[14px] text-danger">{logoError}</p>}
        </Section>

        <Section title="Betalning" icon="card" hint="Visas i rutan Betalningsinformation på fakturan.">
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["bankgiro", "Bankgiro", "123-4567"],
                ["plusgiro", "Plusgiro", "12 34 56-7"],
                ["bankName", "Bank", "Swedbank"],
                ["bankAccount", "Bankkonto (clearing + kontonummer)", "8327-9, 123 456 789-0"],
                ["iban", "IBAN", "SE45 5000 0000 0583 9825 7466"],
                ["bic", "BIC", "ESSESESS"],
              ] as const
            ).map(([k, l, ph]) => (
              <div key={k}>
                <label className="label" htmlFor={k}>{l}</label>
                <input id={k} name={k} value={v[k]} onChange={(e) => set(k, e.target.value)} placeholder={ph} className="input" />
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-1">
            <Toggle name="showOcr" checked={v.showOcr} onChange={(b) => set("showOcr", b)} label="Visa OCR-nummer på fakturan" />
            <p className="text-[13px] text-muted">
              OCR-numret är fakturanumret följt av en kontrollsiffra. Det används som betalningsreferens via bankgiro eller plusgiro, så ett av dem måste vara ifyllt.
            </p>
          </div>
        </Section>

        <Section title="Swish" icon="camera" hint="Kunden skannar QR-koden med Swish-appen och får belopp och fakturanummer ifyllt.">
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="swishNumber">Swish-nummer</label>
              <input
                id="swishNumber"
                name="swishNumber"
                value={v.swishNumber}
                onChange={(e) => set("swishNumber", e.target.value)}
                placeholder="123 456 78 90"
                inputMode="numeric"
                className="input"
                aria-invalid={!swishOk}
              />
              {!swishOk && <p className="mt-1 text-[13px] text-danger">Ange ett Swish-företagsnummer (123…) eller mobilnummer (07…).</p>}
            </div>
            <Toggle name="swishQr" checked={v.swishQr} onChange={(b) => set("swishQr", b)} label="Visa Swish-QR-kod på fakturan" />
          </div>
        </Section>

        <Section title="Betallänk" icon="paperclip" hint="Valfri länk till t.ex. kortbetalning eller en Swish-betalsida. Blir en klickbar knapp i PDF:en.">
          <input name="paymentLink" type="url" value={v.paymentLink} onChange={(e) => set("paymentLink", e.target.value)} placeholder="https://" className="input" />
        </Section>

        <Section title="Kontaktuppgifter och sidfot" icon="building">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="phone">Telefon</label>
              <input id="phone" name="phone" value={v.phone} onChange={(e) => set("phone", e.target.value)} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="website">Webbplats</label>
              <input id="website" name="website" value={v.website} onChange={(e) => set("website", e.target.value)} placeholder="www.exempel.se" className="input" />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="footer">Text i sidfoten</label>
              <textarea
                id="footer"
                name="footer"
                rows={2}
                maxLength={300}
                value={v.footer}
                onChange={(e) => set("footer", e.target.value)}
                placeholder="Vid betalning efter förfallodagen debiteras dröjsmålsränta enligt räntelagen."
                className="input"
              />
            </div>
          </div>
        </Section>

        <div className="no-print sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-full bg-[var(--sidebar)] p-2 pl-5 shadow-lg ring-1 ring-line backdrop-blur-xl">
          <span role="status" className={`mr-auto text-[14px] font-medium ${state?.error ? "text-danger" : "text-success"}`}>
            {state?.error ?? state?.ok ?? ""}
          </span>
          <ConfirmButton>Spara design</ConfirmButton>
        </div>
      </div>

      <div className="xl:sticky xl:top-8">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 pb-3 pt-4">
            <h2 className="text-[17px] font-semibold">Förhandsvisning</h2>
            <a href={src} target="_blank" className="text-[14px] text-brand">Öppna PDF</a>
          </div>
          <div className="bg-surface-2 p-4">
            <div className="mx-auto max-w-[520px] overflow-hidden rounded-md shadow-xl ring-1 ring-black/5">
              <PdfPreview src={src} maxPages={1} label="Förhandsvisning av fakturan" />
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
