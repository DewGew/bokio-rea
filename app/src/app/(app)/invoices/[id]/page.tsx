import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { dateStr } from "@/lib/money";
import { displayStatus } from "@/lib/invoice-status";
import { isVatTreatment } from "@/lib/invoice-rules";
import { Badge, Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PdfPreview } from "@/components/PdfPreview";
import { InvoiceEditor } from "@/components/InvoiceEditor";
import { credit, deleteDraft, markPaid, saveAndSend, saveDraft } from "../actions";

const EVENT_LABEL: Record<string, string> = {
  created: "Skapad",
  issued: "Utfärdad",
  paid: "Betald",
  payment_undone: "Betalning ångrad",
  credited: "Krediterad",
};

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { companyId, company } = await requireCompany();
  const { id } = await params;
  const { error, notice } = await readParams(searchParams);
  const invoice = await db.invoice.findFirst({
    where: { id: Number(id) || -1, companyId },
    include: {
      customer: true,
      lines: { orderBy: { id: "asc" } },
      verification: true,
      paymentVerification: true,
      creditOf: { select: { id: true, number: true } },
      creditNotes: { select: { id: true, number: true } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!invoice) notFound();
  const status = displayStatus(invoice);
  const isCredit = invoice.kind === "credit";

  if (invoice.status === "draft") {
    const [customers, articles] = await Promise.all([
      db.customer.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
      db.article.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
    ]);
    return (
      <>
        <PageHeader
          title="Fakturautkast"
          subtitle={invoice.customer.name}
          actions={
            <>
              <Link href="/invoices" className="btn-secondary">Tillbaka</Link>
              <a href={`/api/invoices/${invoice.id}/pdf`} target="_blank" className="btn-secondary">Förhandsgranska PDF</a>
              <form action={deleteDraft}>
                <input type="hidden" name="id" value={invoice.id} />
                <ConfirmButton className="btn-danger" message="Ta bort utkastet?">Ta bort</ConfirmButton>
              </form>
            </>
          }
        />
        <Flash error={error} notice={notice} />
        <Card className="p-4">
          <InvoiceEditor
            invoice={{
              ...invoice,
              date: dateStr(invoice.date),
              dueDate: dateStr(invoice.dueDate),
              deliveryDate: dateStr(invoice.deliveryDate),
              vatTreatment: isVatTreatment(invoice.vatTreatment) ? invoice.vatTreatment : "standard",
              lines: invoice.lines.map((l) => ({ ...l, periodStart: dateStr(l.periodStart), periodEnd: dateStr(l.periodEnd) })),
            }}
            customers={customers}
            articles={articles}
            seller={{
              name: company.name,
              orgNumber: company.orgNumber,
              vatNumber: company.vatNumber,
              address: company.address,
              postalCode: company.postalCode,
              city: company.city,
              companyType: company.companyType,
              seat: company.seat,
              vatRegistered: company.vatPeriod !== "none",
              bankgiro: company.bankgiro,
              plusgiro: company.plusgiro,
              iban: company.iban,
              swishNumber: company.swishNumber,
            }}
            action={saveDraft}
            sendAction={saveAndSend}
          />
        </Card>
      </>
    );
  }

  const label = isCredit ? "Kreditfaktura" : "Faktura";
  return (
    <>
      <PageHeader
        title={`${label} #${invoice.number}`}
        subtitle={invoice.customer.name}
        actions={
          <>
            <Link href="/invoices" className="btn-secondary">Tillbaka</Link>
            <a href={`/api/invoices/${invoice.id}/pdf`} target="_blank" className="btn-secondary">Visa PDF</a>
            <a href={`/api/invoices/${invoice.id}/pdf?download`} className="btn-primary">Ladda ner PDF</a>
            {invoice.status === "sent" && !isCredit && (
              <form action={credit}>
                <input type="hidden" name="id" value={invoice.id} />
                <ConfirmButton className="btn-danger" message="Kreditera fakturan? En kreditfaktura med eget nummer utfärdas och bokföringen vänds.">
                  Kreditera
                </ConfirmButton>
              </form>
            )}
          </>
        }
      />
      <Flash error={error} notice={notice} />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <div className="bg-surface-2 p-3 sm:p-6">
            <div className="mx-auto max-w-[640px] overflow-hidden rounded-md shadow-xl ring-1 ring-black/5">
              <PdfPreview src={`/api/invoices/${invoice.id}/pdf?v=${invoice.status}`} label={`${label} ${invoice.number}`} />
            </div>
            <p className="mt-3 text-center text-[13px] text-muted">
              {invoice.snapshot
                ? "Innehållet är låst sedan fakturan utfärdades. Bara utseendet följer "
                : "Utseendet ändrar du under "}
              <Link href="/invoices/design" className="text-brand">Fakturadesign</Link>.
            </p>
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Status" action={<Badge status={isCredit ? "credit" : status} />}>
            <div className="space-y-2 p-4 text-sm">
              {invoice.issuedAt && <p>Utfärdad {invoice.issuedAt.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Stockholm" })}</p>}
              {invoice.creditOf && (
                <p>
                  Avser <Link className="text-brand" href={`/invoices/${invoice.creditOf.id}`}>faktura #{invoice.creditOf.number}</Link>
                </p>
              )}
              {invoice.creditNotes.map((c) => (
                <p key={c.id}>
                  Krediterad med <Link className="text-brand" href={`/invoices/${c.id}`}>kreditfaktura #{c.number}</Link>
                </p>
              ))}
              {invoice.verification && (
                <p>
                  Bokförd: <Link className="text-brand" href={`/verifications/${invoice.verification.id}`}>{invoice.verification.series}{invoice.verification.number}</Link>
                </p>
              )}
              {invoice.paymentVerification && (
                <p>
                  Betald {dateStr(invoice.paidDate)}:{" "}
                  <Link className="text-brand" href={`/verifications/${invoice.paymentVerification.id}`}>
                    {invoice.paymentVerification.series}{invoice.paymentVerification.number}
                  </Link>
                </p>
              )}
            </div>
          </Card>
          {invoice.status === "sent" && !isCredit && (
            <Card title="Registrera betalning">
              <form action={markPaid} className="space-y-3 p-4">
                <input type="hidden" name="id" value={invoice.id} />
                <div>
                  <label className="label" htmlFor="paidDate">Betaldatum</label>
                  <input id="paidDate" type="date" name="paidDate" required defaultValue={new Date().toISOString().slice(0, 10)} className="input" />
                </div>
                <div>
                  <label className="label" htmlFor="account">Betalningen kom in på</label>
                  <select id="account" name="account" className="input">
                    <option value="1930">1930 Företagskonto</option>
                    <option value="1910">1910 Kassa</option>
                  </select>
                </div>
                <ConfirmButton>Markera som betald</ConfirmButton>
              </form>
            </Card>
          )}
          {invoice.events.length > 0 && (
            <Card title="Historik">
              <ol className="space-y-2.5 px-4 pb-4 pt-1 text-[13px]">
                {invoice.events.map((e) => (
                  <li key={e.id}>
                    <span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</span>
                    <span className="text-muted"> · {e.createdAt.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Stockholm" })}{e.via ? ` · via ${e.via}` : ""}</span>
                    {e.text && <span className="block text-muted">{e.text}</span>}
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
