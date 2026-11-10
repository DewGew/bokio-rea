import Link from "next/link";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { dateStr, kr } from "@/lib/money";
import { Badge, Card, Empty, Flash, PageHeader, readParams, Segmented, Stat, StatPanel, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { bookSupplierInvoiceAction, paySupplierInvoiceAction } from "./actions";

const FILTERS = [
  ["all", "Alla"],
  ["pending", "Att bokföra"],
  ["booked", "Obetalda"],
  ["overdue", "Förfallna"],
  ["paid", "Betalda"],
] as const;

export default async function SupplierInvoices({ searchParams }: { searchParams: SP }) {
  const { companyId, company } = await requireCompany();
  const { get, error, notice } = await readParams(searchParams);
  const filter = get("status") ?? "all";
  const rows = await db.supplierInvoice.findMany({
    where: { companyId },
    include: { supplier: true, upload: true, verification: true, paymentVerification: true },
    orderBy: [{ dueDate: "asc" }, { date: "desc" }, { id: "desc" }],
  });
  const today = new Date(new Date().toISOString().slice(0, 10));
  const shown = rows.map((r) => ({
    ...r,
    shownStatus: r.status === "paid" ? "paid" : r.status === "pending" ? "pending" : r.dueDate < today ? "overdue" : "booked",
  }));
  const pending = rows.filter((r) => r.status === "pending");
  const booked = rows.filter((r) => r.status === "booked");
  const paid = rows.filter((r) => r.status === "paid");
  const overdue = shown.filter((r) => r.shownStatus === "overdue");
  const list = shown.filter((r) => filter === "all" || r.shownStatus === filter);
  return <>
    <PageHeader title="Leverantörsfakturor" subtitle="Registrera inköp, bokför leverantörsskulder och följ upp betalningar" actions={<Link href="/supplier-invoices/new" className="btn-primary">Ny leverantörsfaktura</Link>} />
    <Flash error={error} notice={notice} />
    <StatPanel className="mb-6">
      <Stat label={company.accountingMethod === "cash" ? "Obetalda" : "Att bokföra"} value={kr(pending.reduce((s, r) => s + r.amount, 0))} hint={`${pending.length} st`} />
      <Stat label="Obetalda" value={kr(booked.reduce((s, r) => s + r.amount, 0))} hint={`${booked.length} st · ${overdue.length} förfallna`} />
      <Stat label="Betalda" value={kr(paid.reduce((s, r) => s + r.amount, 0))} hint={`${paid.length} st`} />
    </StatPanel>
    <Card>
      <div className="px-4 pb-3 pt-4">
        <Segmented active={filter} items={FILTERS.map(([key, label]) => ({ key, label, href: `/supplier-invoices?status=${key}` }))} />
      </div>
      {list.length === 0 ? (
        <Empty href="/supplier-invoices/new" cta="Registrera leverantörsfaktura">{rows.length === 0 ? "Du har inga leverantörsfakturor ännu." : "Inga leverantörsfakturor med den här statusen."}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Fakturanr</th><th>Leverantör</th><th>Fakturadatum</th><th className="hidden md:table-cell">Förfaller</th><th>Status</th><th className="num">Belopp</th><th>Åtgärd</th></tr></thead>
            <tbody>
              {list.map((r) => <tr key={r.id}>
                <td>{r.status === "pending" ? <Link href={`/supplier-invoices/${r.id}/edit`} className="font-medium text-brand">{r.invoiceNumber}</Link> : <span className="font-medium">{r.invoiceNumber}</span>}</td>
                <td>{r.supplier.name}</td>
                <td className="whitespace-nowrap">{dateStr(r.date)}</td>
                <td className="hidden whitespace-nowrap md:table-cell">{dateStr(r.dueDate)}</td>
                <td><Badge status={r.shownStatus} /></td>
                <td className="num">{kr(r.amount)}</td>
                <td><div className="flex flex-wrap items-center gap-2">
                  {r.upload && <a href={`/api/files/${r.upload.id}`} target="_blank" className="text-brand">Bilaga</a>}
                  {r.status === "pending" && <>
                    <Link href={`/supplier-invoices/${r.id}/edit`} className="btn-secondary">Ändra</Link>
                    {company.accountingMethod === "cash"
                      ? <form action={paySupplierInvoiceAction} className="flex items-center gap-2"><input type="hidden" name="id" value={r.id} /><input type="date" name="date" defaultValue={today.toISOString().slice(0,10)} className="input w-auto" /><ConfirmButton>Registrera betalning</ConfirmButton></form>
                      : <form action={bookSupplierInvoiceAction}><input type="hidden" name="id" value={r.id} /><ConfirmButton>Bokför</ConfirmButton></form>}
                  </>}
                  {r.status === "booked" && <form action={paySupplierInvoiceAction} className="flex items-center gap-2"><input type="hidden" name="id" value={r.id} /><input type="date" name="date" defaultValue={today.toISOString().slice(0,10)} className="input w-auto" /><ConfirmButton>Markera betald</ConfirmButton></form>}
                  {r.status === "paid" && r.paymentVerification && <Link href={`/verifications/${r.paymentVerification.id}`} className="text-brand">{r.paymentVerification.series}{r.paymentVerification.number}</Link>}
                </div></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  </>;
}
