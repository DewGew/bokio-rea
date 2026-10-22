"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  SIMPLIFIED_LIMIT,
  VAT_TREATMENTS,
  blocking,
  invoiceTotals,
  suggestedVatNote,
  validateInvoice,
  type ValidationInput,
  type VatTreatment,
} from "@/lib/invoice-rules";

type Line = { description: string; quantity: string; unit: string; unitPrice: string; vatRate: string; discount: string; type: string; periodStart: string; periodEnd: string; showPeriod: boolean };
type Article = { id: number; name: string; unit: string; price: number; vatRate: number; type: string };
type Customer = { id: number; name: string; orgNumber: string; vatNumber: string; address: string; postalCode: string; city: string; country: string; reference: string };

const toNum = (s: string) => Number(String(s).replace(/\s/g, "").replace(",", ".")) || 0;
const toOre = (s: string) => Math.round(toNum(s) * 100);
const fmt = (ore: number) => (ore / 100 || 0).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const emptyLine = (vat = "25"): Line => ({ description: "", quantity: "1", unit: "st", unitPrice: "", vatRate: vat, discount: "", type: "service", periodStart: "", periodEnd: "", showPeriod: false });

export function InvoiceEditor({
  invoice,
  customers,
  articles,
  seller,
  action,
  sendAction,
}: {
  invoice: {
    id: number;
    customerId: number;
    date: string;
    dueDate: string;
    deliveryDate: string;
    ourReference: string;
    theirReference: string;
    notes: string;
    vatTreatment: VatTreatment;
    vatNote: string;
    simplified: boolean;
    lines: { description: string; quantity: number; unit: string; unitPrice: number; vatRate: number; discountBp: number; type: string; periodStart: string; periodEnd: string }[];
  };
  customers: Customer[];
  articles: Article[];
  /** Företagets uppgifter, för valideringen (samma kontroll görs på servern vid utfärdandet). */
  seller: ValidationInput["seller"];
  action: (fd: FormData) => Promise<void>;
  sendAction: (fd: FormData) => Promise<void>;
}) {
  const noVat = !seller.vatRegistered;
  const [customerId, setCustomerId] = useState(invoice.customerId);
  const [date, setDate] = useState(invoice.date);
  const [dueDate, setDueDate] = useState(invoice.dueDate);
  const [deliveryDate, setDeliveryDate] = useState(invoice.deliveryDate);
  const [treatment, setTreatment] = useState<VatTreatment>(invoice.vatTreatment);
  const [vatNote, setVatNote] = useState(invoice.vatNote);
  const [simplified, setSimplified] = useState(invoice.simplified);
  const zero = noVat || VAT_TREATMENTS[treatment].zeroVat;
  const defaultVat = zero ? "0" : "25";
  const [lines, setLines] = useState<Line[]>(
    invoice.lines.length
      ? invoice.lines.map((l) => ({
          description: l.description,
          quantity: String(l.quantity).replace(".", ","),
          unit: l.unit,
          unitPrice: (l.unitPrice / 100).toFixed(2).replace(".", ","),
          vatRate: String(l.vatRate),
          discount: l.discountBp ? String(l.discountBp / 100).replace(".", ",") : "",
          type: l.type,
          periodStart: l.periodStart,
          periodEnd: l.periodEnd,
          showPeriod: !!(l.periodStart || l.periodEnd),
        }))
      : [emptyLine(defaultVat)],
  );
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addArticle = (id: string) => {
    const a = articles.find((x) => String(x.id) === id);
    if (!a) return;
    const line = { ...emptyLine(), description: a.name, unit: a.unit, unitPrice: (a.price / 100).toFixed(2).replace(".", ","), vatRate: zero ? "0" : String(a.vatRate), type: a.type };
    setLines(lines.length === 1 && !lines[0].description && !lines[0].unitPrice ? [line] : [...lines, line]);
  };
  const changeTreatment = (t: VatTreatment) => {
    setTreatment(t);
    if (VAT_TREATMENTS[t].zeroVat) setLines(lines.map((l) => ({ ...l, vatRate: "0" })));
    else if (!noVat && lines.every((l) => l.vatRate === "0")) setLines(lines.map((l) => ({ ...l, vatRate: "25" })));
    setVatNote(suggestedVatNote(t, lines));
  };

  const rules = useMemo(
    () =>
      lines
        .filter((l) => l.description.trim() || l.unitPrice.trim())
        .map((l) => ({
          description: l.description,
          quantity: toNum(l.quantity),
          unitPrice: toOre(l.unitPrice),
          vatRate: Number(l.vatRate),
          discountBp: Math.round(toNum(l.discount) * 100),
          type: l.type,
          periodStart: l.showPeriod ? l.periodStart || null : null,
          periodEnd: l.showPeriod ? l.periodEnd || null : null,
        })),
    [lines],
  );
  const totals = invoiceTotals(rules);
  const customer = customers.find((c) => c.id === customerId) ?? null;
  const issues = validateInvoice({
    seller,
    buyer: customer,
    invoice: { date, dueDate, deliveryDate: deliveryDate || null, vatTreatment: treatment, vatNote, simplified },
    lines: rules,
  });
  const errors = blocking(issues);
  const warnings = issues.filter((i) => i.severity === "warning");
  const terms = date && dueDate ? daysBetween(date, dueDate) : 0;
  const anyDiscount = lines.some((l) => toNum(l.discount) > 0);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="id" value={invoice.id} />
      <input type="hidden" name="lines" value={JSON.stringify(lines.map((l) => ({ ...l, periodStart: l.showPeriod ? l.periodStart : "", periodEnd: l.showPeriod ? l.periodEnd : "" })))} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="customerId">Kund</label>
          <select id="customerId" name="customerId" value={customerId} onChange={(e) => setCustomerId(Number(e.target.value))} className="input">
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {customer && (
            <p className="mt-1 text-[12px] text-muted">
              {[customer.address, `${customer.postalCode} ${customer.city}`.trim(), customer.country !== "SE" ? customer.country : "", customer.vatNumber].filter(Boolean).join(" · ") || "Adress saknas"} ·{" "}
              <Link href={`/customers?edit=${customer.id}`} className="text-brand">Ändra kund</Link>
            </p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="ourReference">Vår referens</label>
          <input id="ourReference" name="ourReference" defaultValue={invoice.ourReference} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="theirReference">Er referens</label>
          <input id="theirReference" name="theirReference" defaultValue={invoice.theirReference} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="date">Fakturadatum</label>
          <input
            id="date"
            type="date"
            name="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              if (e.target.value) setDueDate(addDays(e.target.value, terms));
            }}
            required
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="terms">Betalningsvillkor (dagar)</label>
          <input
            id="terms"
            type="number"
            min={0}
            max={365}
            value={terms}
            onChange={(e) => setDueDate(addDays(date, Math.max(0, Math.min(365, Number(e.target.value) || 0))))}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="dueDate">Förfallodatum</label>
          <input id="dueDate" type="date" name="dueDate" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="deliveryDate">Leveransdatum</label>
          <input id="deliveryDate" type="date" name="deliveryDate" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="input" />
          <p className="mt-1 text-[12px] text-muted">Om varan levererades eller tjänsten utfördes ett annat datum.</p>
        </div>
      </div>

      <div className="grid gap-4 rounded-2xl bg-surface-2 p-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="vatTreatment">Momshantering</label>
          <select id="vatTreatment" name="vatTreatment" value={treatment} disabled={noVat} onChange={(e) => changeTreatment(e.target.value as VatTreatment)} className="input">
            {(Object.keys(VAT_TREATMENTS) as VatTreatment[]).map((k) => (
              <option key={k} value={k}>{VAT_TREATMENTS[k].label}</option>
            ))}
          </select>
          {noVat && <input type="hidden" name="vatTreatment" value="standard" />}
          <p className="mt-1 text-[12px] text-muted">{noVat ? "Företaget är inte momsregistrerat – ingen moms debiteras." : VAT_TREATMENTS[treatment].hint}</p>
        </div>
        <div>
          <label className="label" htmlFor="vatNote">Fakturatext om moms (hänvisning)</label>
          <input id="vatNote" name="vatNote" value={vatNote} onChange={(e) => setVatNote(e.target.value)} placeholder={zero ? suggestedVatNote(treatment, rules) : "Behövs bara vid 0 % moms"} className="input" />
          {zero && !noVat && suggestedVatNote(treatment, rules) && vatNote !== suggestedVatNote(treatment, rules) && (
            <button type="button" onClick={() => setVatNote(suggestedVatNote(treatment, rules))} className="mt-1 text-[12px] font-medium text-brand">
              Använd förslag: &quot;{suggestedVatNote(treatment, rules)}&quot;
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="table table-edit min-w-[880px]">
          <thead>
            <tr>
              <th>Beskrivning</th>
              <th className="w-24">Typ</th>
              <th className="w-20">Antal</th>
              <th className="w-16">Enhet</th>
              <th className="w-28">À-pris exkl.</th>
              <th className="w-20">Rabatt %</th>
              <th className="w-24">Moms</th>
              <th className="num w-28">Belopp</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const r = { quantity: toNum(l.quantity), unitPrice: toOre(l.unitPrice), discountBp: Math.round(toNum(l.discount) * 100) };
              const net = invoiceTotals([{ ...r, vatRate: 0 }]).net;
              return (
                <tr key={i} className="align-top">
                  <td>
                    <textarea
                      aria-label="Beskrivning"
                      rows={Math.min(4, Math.max(1, Math.ceil(l.description.length / 48)))}
                      value={l.description}
                      onChange={(e) => set(i, { description: e.target.value })}
                      className="input min-w-56 resize-y"
                    />
                    {l.showPeriod ? (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted">
                        Period
                        <input type="date" aria-label="Period från" value={l.periodStart} onChange={(e) => set(i, { periodStart: e.target.value })} className="input w-auto py-1 text-[13px]" />
                        –
                        <input type="date" aria-label="Period till" value={l.periodEnd} onChange={(e) => set(i, { periodEnd: e.target.value })} className="input w-auto py-1 text-[13px]" />
                        <button type="button" aria-label="Ta bort period" onClick={() => set(i, { showPeriod: false, periodStart: "", periodEnd: "" })} className="px-1 hover:text-danger">×</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => set(i, { showPeriod: true })} className="mt-1 text-[12px] font-medium text-brand">
                        + Tjänsteperiod
                      </button>
                    )}
                  </td>
                  <td>
                    <select aria-label="Typ" value={l.type} onChange={(e) => set(i, { type: e.target.value })} className="input">
                      <option value="service">Tjänst</option>
                      <option value="goods">Vara</option>
                    </select>
                  </td>
                  <td><input aria-label="Antal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} className="input text-right" inputMode="decimal" /></td>
                  <td><input aria-label="Enhet" value={l.unit} onChange={(e) => set(i, { unit: e.target.value })} className="input" /></td>
                  <td><input aria-label="À-pris exklusive moms" value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} className="input text-right" inputMode="decimal" /></td>
                  <td><input aria-label="Rabatt i procent" value={l.discount} onChange={(e) => set(i, { discount: e.target.value })} placeholder="0" className="input text-right" inputMode="decimal" /></td>
                  <td>
                    <select aria-label="Moms" value={l.vatRate} disabled={zero} onChange={(e) => set(i, { vatRate: e.target.value })} className="input">
                      <option value="25">25 %</option>
                      <option value="12">12 %</option>
                      <option value="6">6 %</option>
                      <option value="0">0 %</option>
                    </select>
                  </td>
                  <td className="num pt-3">{fmt(net)}</td>
                  <td className="pt-2.5">
                    <button type="button" aria-label="Ta bort rad" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-muted hover:text-danger">×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center gap-3 p-3">
          <button type="button" onClick={() => setLines([...lines, emptyLine(defaultVat)])} className="btn-secondary">+ Rad</button>
          {articles.length > 0 && (
            <select aria-label="Lägg till artikel" value="" onChange={(e) => addArticle(e.target.value)} className="input w-auto">
              <option value="">+ Lägg till artikel…</option>
              {articles.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="notes">Meddelande på fakturan</label>
            <textarea id="notes" name="notes" defaultValue={invoice.notes} rows={3} className="input" />
          </div>
          {(Math.abs(totals.total) <= SIMPLIFIED_LIMIT || simplified) && (
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" name="simplified" checked={simplified} onChange={(e) => setSimplified(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
              <span>
                <span className="font-medium">Förenklad faktura</span>
                <span className="block text-muted">Tillåten när totalbeloppet är högst 4 000 kr inkl. moms. Kundens adress behöver då inte anges.</span>
              </span>
            </label>
          )}
        </div>
        <div className="space-y-1 self-end text-sm">
          {anyDiscount && (
            <>
              <div className="flex justify-between text-muted"><span>Summa före rabatt</span><span className="tabular-nums">{fmt(totals.net + totals.discount)} kr</span></div>
              <div className="flex justify-between text-muted"><span>Rabatt</span><span className="tabular-nums">−{fmt(totals.discount)} kr</span></div>
            </>
          )}
          <div className="flex justify-between"><span>Summa exkl. moms</span><span className="tabular-nums">{fmt(totals.net)} kr</span></div>
          {[...totals.byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, v]) => (
            <div key={rate} className="flex justify-between text-muted">
              <span>Moms {rate} % på {fmt(v.net)}</span>
              <span className="tabular-nums">{fmt(v.vat)} kr</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><span>Att betala</span><span className="tabular-nums">{fmt(totals.total)} kr</span></div>
        </div>
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="space-y-2">
          {errors.length > 0 && (
            <div role="alert" className="rounded-2xl bg-danger-soft p-4 text-[14px] text-danger">
              <p className="mb-1 font-semibold">Det här behöver rättas innan fakturan kan utfärdas</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {errors.map((e) => (
                  <li key={e.field + e.message}>{e.message}</li>
                ))}
              </ul>
              {errors.some((e) => e.field.startsWith("seller")) && (
                <p className="mt-2">
                  <Link href="/settings" className="font-semibold underline">Öppna företagsinställningarna</Link>
                </p>
              )}
            </div>
          )}
          {warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 rounded-2xl bg-warn-soft p-4 pl-9 text-[14px] text-warn">
              {warnings.map((w) => (
                <li key={w.field + w.message}>{w.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-secondary">Spara utkast</button>
        <button
          formAction={sendAction}
          disabled={errors.length > 0}
          className="btn-primary"
          onClick={(e) => {
            if (!confirm("Utfärda fakturan? Den får nästa fakturanummer, bokförs och kan sedan inte ändras – bara krediteras.")) e.preventDefault();
          }}
        >
          Utfärda faktura
        </button>
      </div>
    </form>
  );
}
