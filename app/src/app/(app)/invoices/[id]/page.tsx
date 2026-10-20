import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { dateStr } from "@/lib/money";
import { displayStatus } from "@/lib/invoice-status";
import { Badge, Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PdfPreview } from "@/components/PdfPreview";
import { InvoiceEditor } from "@/components/InvoiceEditor";
import { credit, deleteDraft, markPaid, saveAndSend, saveDraft } from "../actions";

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { companyId, company } = await requireCompany();
  const { id } = await params;
  const { error, notice } = await readParams(searchParams);
  const invoice = await db.invoice.findFirst({
    where: { id: Number(id) || -1, companyId },
    include: { customer: true, lines: { orderBy: { id: "asc" } }, verification: true, paymentVerification: true },
  });
  if (!invoice) notFound();
    const status = displayStatus(invoice);

  if (invoice.status === "draft") {
    const [customers, articles] = await Promise.all([db.customer.findMany({ where: { companyId }, orderBy: { name: "asc" } }), db.article.findMany({ where: { companyId }, orderBy: { name: "asc" } })]);
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
            invoice={{ ...invoice, date: dateStr(invoice.date), dueDate: dateStr(invoice.dueDate) }}
            customers={customers}
            articles={articles}
            action={saveDraft}
            sendAction={saveAndSend}
            noVat={company.vatPeriod === "none"}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Faktura #${invoice.number}`}
        subtitle={invoice.customer.name}
        actions={
          <>
            <Link href="/invoices" className="btn-secondary">Tillbaka</Link>
            <a href={`/api/invoices/${invoice.id}/pdf`} target="_blank" className="btn-secondary">Visa PDF</a>
            <a href={`/api/invoices/${invoice.id}/pdf?download`} className="btn-primary">Ladda ner PDF</a>
            {invoice.status === "sent" && (
              <form action={credit}>
                <input type="hidden" name="id" value={invoice.id} />
                <ConfirmButton className="btn-danger" message="Kreditera fakturan? Bokföringen vänds.">Kreditera</ConfirmButton>
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
              <PdfPreview src={`/api/invoices/${invoice.id}/pdf?v=${invoice.status}`} label={`Faktura ${invoice.number}`} />
            </div>
            <p className="mt-3 text-center text-[13px] text-muted">
              Utseendet ändrar du under <Link href="/invoices/design" className="text-brand">Fakturadesign</Link>.
            </p>
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Status" action={<Badge status={status} />}>
            <div className="space-y-2 p-4 text-sm">
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
          {invoice.status === "sent" && (
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
        </div>
      </div>
    </>
  );
}
