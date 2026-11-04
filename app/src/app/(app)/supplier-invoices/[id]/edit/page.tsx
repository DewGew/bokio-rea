import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { dateStr } from "@/lib/money";
import { Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { updateSupplierInvoice } from "../../actions";

export default async function EditSupplierInvoice({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { id } = await params;
  const { error, notice } = await readParams(searchParams);
  const invoice = await db.supplierInvoice.findFirst({
    where: { id: Number(id) || -1, companyId, status: "pending" },
    include: { supplier: true, upload: true },
  });
  if (!invoice) notFound();
  const [accounts, uploads] = await Promise.all([
    db.account.findMany({ where: { companyId, active: true, number: { gte: 4000, lt: 8000 } }, orderBy: { number: "asc" }, select: { number: true, name: true } }),
    db.upload.findMany({
      where: { companyId, verificationId: null, expense: null, OR: [{ supplierInvoice: null }, { supplierInvoice: { id: invoice.id } }] },
      orderBy: { createdAt: "desc" }, select: { id: true, fileName: true },
    }),
  ]);
  const money = (value: number) => (value / 100).toFixed(2).replace(".", ",");
  return <>
    <PageHeader title="Ändra leverantörsfaktura" subtitle={invoice.supplier.name} actions={<Link href="/supplier-invoices" className="btn-secondary">Tillbaka</Link>} />
    <Flash error={error} notice={notice} />
    <Card title="Fakturauppgifter">
      <form action={updateSupplierInvoice} className="grid gap-4 p-4 sm:grid-cols-2">
        <input type="hidden" name="id" value={invoice.id} />
        <div className="sm:col-span-2"><label className="label" htmlFor="supplier">Leverantör</label><input id="supplier" name="supplier" required defaultValue={invoice.supplier.name} className="input" /></div>
        <div><label className="label" htmlFor="supplierOrgNumber">Organisationsnummer</label><input id="supplierOrgNumber" name="supplierOrgNumber" defaultValue={invoice.supplier.orgNumber} className="input" /></div>
        <div><label className="label" htmlFor="invoiceNumber">Fakturanummer</label><input id="invoiceNumber" name="invoiceNumber" required defaultValue={invoice.invoiceNumber} className="input" /></div>
        <div><label className="label" htmlFor="date">Fakturadatum</label><input id="date" type="date" name="date" required defaultValue={dateStr(invoice.date)} className="input" /></div>
        <div><label className="label" htmlFor="dueDate">Förfallodatum</label><input id="dueDate" type="date" name="dueDate" required defaultValue={dateStr(invoice.dueDate)} className="input" /></div>
        <div><label className="label" htmlFor="amount">Belopp inklusive moms (kr)</label><input id="amount" name="amount" required defaultValue={money(invoice.amount)} className="input" /></div>
        <div><label className="label" htmlFor="vatAmount">Momsbelopp (kr)</label><input id="vatAmount" name="vatAmount" defaultValue={money(invoice.vatAmount)} className="input" /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="costAccount">Kostnadskonto</label><select id="costAccount" name="costAccount" defaultValue={invoice.costAccount} className="input">{accounts.map((a) => <option key={a.number} value={a.number}>{a.number} – {a.name}</option>)}</select></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="description">Beskrivning</label><input id="description" name="description" defaultValue={invoice.description} className="input" /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="uploadId">Bifogad faktura</label><select id="uploadId" name="uploadId" defaultValue={invoice.uploadId ?? ""} className="input"><option value="">Ingen bilaga</option>{uploads.map((u) => <option key={u.id} value={u.id}>{u.fileName}</option>)}</select></div>
        <div className="sm:col-span-2 flex justify-between items-center"><p className="text-sm text-muted">Ändringar kan göras fram till att fakturan bokförs.</p><ConfirmButton>Spara ändringar</ConfirmButton></div>
      </form>
    </Card>
  </>;
}
