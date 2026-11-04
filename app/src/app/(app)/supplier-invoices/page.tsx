import Link from "next/link";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { dateStr, kr } from "@/lib/money";
import { Card, Empty, Flash, PageHeader, readParams, Stat, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { bookSupplierInvoiceAction, paySupplierInvoiceAction } from "./actions";

export default async function SupplierInvoices({ searchParams }: { searchParams: SP }) {
  const { companyId, company } = await requireCompany();
  const { error, notice } = await readParams(searchParams);
  const rows = await db.supplierInvoice.findMany({
    where: { companyId },
    include: { supplier: true, upload: true, verification: true, paymentVerification: true },
    orderBy: [{ dueDate: "asc" }, { date: "desc" }],
  });
  const pending = rows.filter((r) => r.status === "pending");
  const booked = rows.filter((r) => r.status === "booked");
  const paid = rows.filter((r) => r.status === "paid");
  const today = new Date(new Date().toISOString().slice(0, 10));
  const overdue = booked.filter((r) => r.dueDate < today);
  return <>
    <PageHeader title="Leverantörsfakturor" subtitle="Registrera inköp, bokför leverantörsskulder och följ upp betalningar" actions={<Link href="/supplier-invoices/new" className="btn-primary">Ny leverantörsfaktura</Link>} />
    <Flash error={error} notice={notice} />
    <div className="mb-6 grid gap-3 sm:grid-cols-3">
      <Stat label={company.accountingMethod === "cash" ? "Obetalda" : "Att bokföra"} value={kr(pending.reduce((s, r) => s + r.amount, 0))} hint={`${pending.length} st`} />
      <Stat label="Obetalda" value={kr(booked.reduce((s, r) => s + r.amount, 0))} hint={`${booked.length} st · ${overdue.length} förfallna`} />
      <Stat label="Betalda" value={kr(paid.reduce((s, r) => s + r.amount, 0))} hint={`${paid.length} st`} />
    </div>
    <Card title={company.accountingMethod === "cash" ? "Obetalda fakturor – kontantmetoden" : "Att bokföra"}>
      {pending.length ? <div className="overflow-x-auto"><table className="table"><thead><tr><th>Leverantör</th><th>Fakturanr</th><th>Datum</th><th>Förfallodatum</th><th className="num">Belopp</th><th /></tr></thead><tbody>
        {pending.map((r) => <tr key={r.id}><td>{r.supplier.name}</td><td>{r.invoiceNumber}</td><td>{dateStr(r.date)}</td><td>{dateStr(r.dueDate)}</td><td className="num">{kr(r.amount)}</td><td><div className="flex items-center gap-2">
          {r.upload && <a href={`/api/files/${r.upload.id}`} target="_blank" className="text-brand">Bilaga</a>}
          <Link href={`/supplier-invoices/${r.id}/edit`} className="btn-secondary">Ändra</Link>
          {company.accountingMethod === "cash"
            ? <form action={paySupplierInvoiceAction} className="flex items-center gap-2"><input type="hidden" name="id" value={r.id} /><input type="date" name="date" defaultValue={today.toISOString().slice(0,10)} className="input w-auto" /><ConfirmButton>Registrera betalning</ConfirmButton></form>
            : <form action={bookSupplierInvoiceAction}><input type="hidden" name="id" value={r.id} /><ConfirmButton>Bokför</ConfirmButton></form>}
        </div></td></tr>)}
      </tbody></table></div> : <Empty>Inga leverantörsfakturor väntar.</Empty>}
    </Card>
    {booked.length > 0 && <div className="mt-6"><Card title="Obetalda fakturor">
      <div className="overflow-x-auto"><table className="table"><thead><tr><th>Leverantör</th><th>Fakturanr</th><th>Förfallodatum</th><th className="num">Belopp</th><th>Åtgärd</th></tr></thead><tbody>
        {booked.map((r) => <tr key={r.id}><td>{r.supplier.name}</td><td>{r.invoiceNumber}</td><td>{dateStr(r.dueDate)}{r.dueDate < today && <span className="ml-2 text-danger">Förfallen</span>}</td><td className="num">{kr(r.amount)}</td><td><form action={paySupplierInvoiceAction} className="flex items-center gap-2"><input type="hidden" name="id" value={r.id} /><input type="date" name="date" defaultValue={today.toISOString().slice(0,10)} className="input w-auto" /><ConfirmButton>Markera betald</ConfirmButton></form></td></tr>)}
      </tbody></table></div>
    </Card></div>}
    {paid.length > 0 && <div className="mt-6"><Card title="Betalda"><div className="overflow-x-auto"><table className="table"><thead><tr><th>Leverantör</th><th>Fakturanr</th><th>Fakturadatum</th><th className="num">Belopp</th><th>Verifikat</th></tr></thead><tbody>
      {paid.map((r) => <tr key={r.id}><td>{r.supplier.name}</td><td>{r.invoiceNumber}</td><td>{dateStr(r.date)}</td><td className="num">{kr(r.amount)}</td><td>{r.paymentVerification && <Link href={`/verifications/${r.paymentVerification.id}`} className="text-brand">{r.paymentVerification.series}{r.paymentVerification.number}</Link>}</td></tr>)}
    </tbody></table></div></Card></div>}
  </>;
}
