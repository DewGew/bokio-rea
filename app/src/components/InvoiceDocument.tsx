import type { Company, Customer, Invoice, InvoiceLine } from "@prisma/client";
import { invoiceTotals } from "@/lib/accounting";
import { dateStr, kr, num } from "@/lib/money";

export function InvoiceDocument({ invoice, company }: { invoice: Invoice & { customer: Customer; lines: InvoiceLine[] }; company: Company }) {
  const t = invoiceTotals(invoice.lines);
  const c = invoice.customer;
  return (
    <article className="mx-auto max-w-3xl bg-white p-8 text-sm text-black sm:p-12">
      <header className="flex flex-wrap justify-between gap-6">
        <div>
          <p className="text-xl font-semibold">{company.name}</p>
          <p className="text-gray-600">
            {company.address}
            <br />
            {company.postalCode} {company.city}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tracking-tight">{invoice.status === "credited" ? "Faktura (krediterad)" : "Faktura"}</p>
          <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-0.5 text-gray-700">
            <dt>Fakturanummer</dt>
            <dd className="font-medium">{invoice.number ?? "Utkast"}</dd>
            <dt>Fakturadatum</dt>
            <dd>{dateStr(invoice.date)}</dd>
            <dt>Förfallodatum</dt>
            <dd className="font-medium">{dateStr(invoice.dueDate)}</dd>
          </dl>
        </div>
      </header>

      <section className="mt-10 grid gap-6 sm:grid-cols-2">
        <div className="text-gray-700">
          {invoice.ourReference && <p>Vår referens: {invoice.ourReference}</p>}
          {invoice.theirReference && <p>Er referens: {invoice.theirReference}</p>}
        </div>
        <div className="rounded border border-gray-200 p-4">
          <p className="font-medium">{c.name}</p>
          {c.address && <p>{c.address}</p>}
          {(c.postalCode || c.city) && <p>{c.postalCode} {c.city}</p>}
          {c.orgNumber && <p className="mt-1 text-gray-600">Org.nr {c.orgNumber}</p>}
        </div>
      </section>

      <table className="mt-10 w-full">
        <thead>
          <tr className="border-b border-gray-300 text-left text-xs text-gray-600">
            <th className="py-2">Beskrivning</th>
            <th className="py-2 text-right">Antal</th>
            <th className="py-2 text-right">À-pris</th>
            <th className="py-2 text-right">Moms</th>
            <th className="py-2 text-right">Belopp</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l) => (
            <tr key={l.id} className="border-b border-gray-100">
              <td className="py-2">{l.description}</td>
              <td className="py-2 text-right tabular-nums">{l.quantity.toLocaleString("sv-SE")} {l.unit}</td>
              <td className="py-2 text-right tabular-nums">{num(l.unitPrice)}</td>
              <td className="py-2 text-right">{l.vatRate} %</td>
              <td className="py-2 text-right tabular-nums">{num(Math.round(l.quantity * l.unitPrice))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 ml-auto w-full max-w-xs space-y-1">
        <div className="flex justify-between"><span>Belopp exkl. moms</span><span className="tabular-nums">{kr(t.net)}</span></div>
        {[...t.byRate.entries()].filter(([r]) => r > 0).map(([rate, v]) => (
          <div key={rate} className="flex justify-between text-gray-700">
            <span>Moms {rate} % (på {num(v.net)})</span>
            <span className="tabular-nums">{kr(v.vat)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-gray-300 pt-2 text-base font-semibold">
          <span>Att betala</span>
          <span className="tabular-nums">{kr(t.total)}</span>
        </div>
      </div>

      {invoice.notes && <p className="mt-8 whitespace-pre-line text-gray-700">{invoice.notes}</p>}

      <footer className="mt-12 grid gap-4 border-t border-gray-200 pt-4 text-xs text-gray-600 sm:grid-cols-3">
        <div>
          <p className="font-medium text-gray-800">Betalning</p>
          {company.bankgiro && <p>Bankgiro {company.bankgiro}</p>}
          <p>Ange fakturanummer {invoice.number ?? ""} som referens</p>
        </div>
        <div>
          <p className="font-medium text-gray-800">Företagsuppgifter</p>
          <p>Org.nr {company.orgNumber}</p>
          {company.vatNumber && <p>Momsreg.nr {company.vatNumber}</p>}
          <p>Godkänd för F-skatt</p>
        </div>
        <div>
          <p className="font-medium text-gray-800">Kontakt</p>
          {company.email && <p>{company.email}</p>}
          <p>Vid sen betalning debiteras dröjsmålsränta enligt räntelagen.</p>
        </div>
      </footer>
    </article>
  );
}
