import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { dateStr, kr } from "@/lib/money";
import { invoiceTotals } from "@/lib/invoice-rules";
import { Badge, Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { QuoteEditor } from "@/components/QuoteEditor";
import { ConfirmButton } from "@/components/ConfirmButton";
import { saveQuote, setQuoteStatus, convertQuote, deleteQuote } from "../actions";

export default async function QuotePage({ params, searchParams }: { params: Promise<{id:string}>; searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { id } = await params;
  const { error, notice } = await readParams(searchParams);
  const quote = await db.quote.findFirst({ where: { id: Number(id) || -1, companyId }, include: { customer: true, lines: { orderBy: { id: "asc" } } } });
  if (!quote) notFound();
  const expired = quote.validUntil < new Date(new Date().toISOString().slice(0,10)) && !["converted","rejected","draft"].includes(quote.status);
  const status = expired ? "expired" : quote.status;
  const customers = await db.customer.findMany({ where: { companyId }, orderBy: { name: "asc" } });
  const editable = ["draft","sent"].includes(quote.status) && !expired;
  const total = invoiceTotals(quote.lines).total;
  return <>
    <PageHeader title={quote.number == null ? "Offertutkast" : `Offert #${quote.number}`} subtitle={quote.customer.name} actions={<><Link href="/quotes" className="btn-secondary">Tillbaka</Link><a href={`/api/quotes/${quote.id}/pdf`} target="_blank" className="btn-secondary">Förhandsgranska PDF</a><a href={`/api/quotes/${quote.id}/pdf?download`} className="btn-secondary">Ladda ner PDF</a>{quote.invoiceId && <Link href={`/invoices/${quote.invoiceId}`} className="btn-primary">Öppna faktura</Link>}</>} />
    <Flash error={error} notice={notice} />
    <Card className="p-4">
      {editable ? <QuoteEditor key={quote.id} quote={{ id: quote.id, customerId: quote.customerId, date: dateStr(quote.date), validUntil: dateStr(quote.validUntil), notes: quote.notes, lines: quote.lines }} customers={customers} action={saveQuote} /> : <div className="space-y-4">
        <div className="flex items-center justify-between"><Badge status={status} /><span className="text-sm text-muted">Giltig till {dateStr(quote.validUntil)}</span></div>
        <div className="overflow-x-auto"><table className="table"><thead><tr><th>Beskrivning</th><th>Antal</th><th>À-pris</th><th>Moms</th><th className="num">Belopp</th></tr></thead><tbody>{quote.lines.map(l => <tr key={l.id}><td>{l.description}</td><td>{l.quantity} {l.unit}</td><td>{kr(l.unitPrice)}</td><td>{l.vatRate} %</td><td className="num">{kr(Math.round(l.quantity*l.unitPrice*(1-l.discountBp/10000)*(1+l.vatRate/100)))}</td></tr>)}</tbody></table></div>
        {quote.notes && <div><p className="mb-1 text-sm font-medium">Meddelande på offerten</p><p className="whitespace-pre-wrap text-sm">{quote.notes}</p></div>}
        <p className="text-right text-lg font-semibold">Totalt: {kr(total)}</p>
      </div>}
    </Card>
    {(editable || (status === "accepted" && !quote.invoiceId)) && <div className="mt-4 flex flex-wrap gap-2">
      {quote.status === "draft" && <><form action={setQuoteStatus}><input type="hidden" name="id" value={quote.id}/><input type="hidden" name="status" value="sent"/><button className="btn-secondary">Markera som skickad</button></form><form action={deleteQuote}><input type="hidden" name="id" value={quote.id}/><ConfirmButton className="btn-danger" message="Vill du ta bort offertutkastet? Åtgärden kan inte ångras.">Ta bort utkast</ConfirmButton></form></> }
      {quote.status === "sent" && <><form action={setQuoteStatus}><input type="hidden" name="id" value={quote.id}/><input type="hidden" name="status" value="accepted"/><button className="btn-primary">Markera som accepterad</button></form><form action={setQuoteStatus}><input type="hidden" name="id" value={quote.id}/><input type="hidden" name="status" value="rejected"/><button className="btn-secondary">Markera som avböjd</button></form></>}
      {status === "accepted" && !quote.invoiceId && <form action={convertQuote}><input type="hidden" name="id" value={quote.id}/><button className="btn-primary">Omvandla till fakturautkast</button></form>}
    </div>}
    {status === "accepted" && !quote.invoiceId && <p className="mt-3 text-sm text-muted">Offerten är accepterad. Omvandla den till ett fakturautkast när du vill fortsätta med faktureringen.</p>}
    <p className="mt-4 text-xs text-muted">En offert bokförs inte och påverkar inte momsredovisningen. Omvandling skapar ett separat fakturautkast som du granskar och utfärdar.</p>
  </>;
}
