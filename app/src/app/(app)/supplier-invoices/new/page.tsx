import Link from "next/link";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { createSupplierInvoice } from "../actions";
import { readUpload } from "@/lib/receipt-read";
import { aiEnabled, type ReceiptData } from "@/lib/receipt-ai";

export default async function NewSupplierInvoice({ searchParams }: { searchParams: SP }) {
  const { companyId, company } = await requireCompany();
  const { get, error, notice } = await readParams(searchParams);
  const uploadId = Number(get("uploadId")) || null;
  const uploads = await db.upload.findMany({
    where: { companyId, verificationId: null, expense: null, supplierInvoice: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, fileName: true },
  });
  const accounts = await db.account.findMany({
    where: { companyId, active: true, number: { gte: 4000, lt: 8000 } },
    orderBy: { number: "asc" },
    select: { number: true, name: true },
  });

  let ai: ReceiptData | null = null;
  let aiMessage = "";
  if (uploadId && company.plan === "pro" && aiEnabled()) {
    const result = await readUpload(companyId, uploadId);
    if (result.status === "done" && result.data.documentType === "invoice") ai = result.data;
    else if (result.status === "done") aiMessage = "AI bedömde underlaget som ett kvitto eller annat dokument. Du kan fylla i fakturan manuellt.";
    else if (result.status === "error") aiMessage = result.error;
    else aiMessage = "AI-avläsning är inte tillgänglig just nu. Fyll i uppgifterna manuellt.";
  }
  const selectedUpload = uploads.find((u) => u.id === uploadId);
  const date = ai?.date ?? new Date().toISOString().slice(0, 10);
  const dueDate = ai?.dueDate ?? date;
  const total = ai?.total && ai.currency === "SEK" ? ai.total.toFixed(2).replace(".", ",") : "";
  const vatAmount = ai?.vat.length ? ai.vat.reduce((sum, item) => sum + item.amount, 0).toFixed(2).replace(".", ",") : "0,00";
  const suggestedAccount = ai?.templateId
    ? (await db.template.findFirst({ where: { id: ai.templateId, companyId }, select: { costAccount: true } }))?.costAccount
    : undefined;

  return <>
    <PageHeader title="Ny leverantörsfaktura" subtitle="Fyll i manuellt eller låt AI läsa fakturan"
      actions={<Link href="/supplier-invoices" className="btn-secondary">Tillbaka</Link>} />
    <Flash error={error} notice={notice} />
    {ai && <p className="mb-4 rounded-xl bg-success-soft p-3 text-sm text-success">AI har läst fakturan. Kontrollera och rätta uppgifterna innan du sparar. Ingenting bokförs automatiskt.</p>}
    {aiMessage && <p className="mb-4 rounded-xl bg-warn-soft p-3 text-sm text-warn">{aiMessage}</p>}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card title="Fakturauppgifter">
        <form action={createSupplierInvoice} className="grid gap-4 p-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><label className="label" htmlFor="supplier">Leverantör</label><input id="supplier" name="supplier" required defaultValue={ai?.supplier ?? ""} className="input" /></div>
          <div><label className="label" htmlFor="supplierOrgNumber">Organisationsnummer</label><input id="supplierOrgNumber" name="supplierOrgNumber" defaultValue={ai?.supplierOrgNumber ?? ""} className="input" /></div>
          <div><label className="label" htmlFor="invoiceNumber">Fakturanummer</label><input id="invoiceNumber" name="invoiceNumber" required defaultValue={ai?.invoiceNumber ?? ""} className="input" /></div>
          <div><label className="label" htmlFor="date">Fakturadatum</label><input id="date" type="date" name="date" required defaultValue={date} className="input" /></div>
          <div><label className="label" htmlFor="dueDate">Förfallodatum</label><input id="dueDate" type="date" name="dueDate" required defaultValue={dueDate} className="input" /></div>
          <div><label className="label" htmlFor="amount">Belopp inklusive moms (kr)</label><input id="amount" name="amount" required defaultValue={total} placeholder="0,00" className="input" /></div>
          <div><label className="label" htmlFor="vatAmount">Momsbelopp (kr)</label><input id="vatAmount" name="vatAmount" defaultValue={vatAmount} className="input" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="costAccount">Kostnadskonto</label><select id="costAccount" name="costAccount" defaultValue={suggestedAccount ?? 6991} className="input">{accounts.map((a) => <option key={a.number} value={a.number}>{a.number} – {a.name}</option>)}</select></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="description">Beskrivning</label><input id="description" name="description" defaultValue={ai?.description ?? ""} className="input" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="uploadId">Bifogad faktura</label><select id="uploadId" name="uploadId" defaultValue={uploadId ?? ""} className="input"><option value="">Ingen bilaga</option>{uploads.map((u) => <option key={u.id} value={u.id}>{u.fileName}</option>)}</select></div>
          <div className="flex justify-end sm:col-span-2"><ConfirmButton>Spara faktura</ConfirmButton></div>
        </form>
      </Card>
      <Card title="AI-avläsning" className="p-4">
        <p className="mb-3 text-sm text-muted">AI-avläsning av PDF och bilder ingår i Pro. I Bas kan alla uppgifter registreras manuellt.</p>
        {selectedUpload && <p className="mb-3 text-sm">Vald fil: <strong>{selectedUpload.fileName}</strong></p>}
        <Link href="/uploads" className="btn-secondary w-full">Öppna uppladdade filer</Link>
      </Card>
    </div>
  </>;
}
