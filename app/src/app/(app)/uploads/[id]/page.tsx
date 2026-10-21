import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { Card, Flash, PageHeader, readParams, Segmented, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { BookingWizard } from "@/components/BookingWizard";
import { AI_VERSION, aiEnabled, type ReceiptData } from "@/lib/receipt-ai";
import { PdfPreview } from "@/components/PdfPreview";
import { VerificationEditor } from "@/components/VerificationEditor";
import { ExpenseFields } from "@/components/ExpenseFields";
import { createManualVerification } from "@/app/(app)/verifications/actions";
import { deleteUpload, uploadAsExpense } from "../actions";

const TABS = [
  ["template", "Bokför med mall"],
  ["manual", "Bokför manuellt"],
  ["expense", "Registrera som utlägg"],
] as const;

export default async function UploadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { companyId, company } = await requireCompany();
  const { id } = await params;
  const { get, error, notice } = await readParams(searchParams);
  const tab = get("tab") ?? "template";
  const u = await db.upload.findFirst({ where: { id: Number(id) || -1, companyId }, include: { verification: true, expense: true } });
  if (!u) notFound();
  const done = u.verification || u.expense;

  const [templates, accounts] = await Promise.all([
    db.template.findMany({ where: { companyId }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.account.findMany({ where: { companyId, active: true }, orderBy: { number: "asc" }, select: { number: true, name: true } }),
  ]);
  const src = `/api/files/${u.id}`;

  return (
    <>
      <PageHeader
        title={u.fileName}
        subtitle={done ? "Underlaget är hanterat" : "Välj hur underlaget ska bokföras"}
        actions={
          <>
            <Link href="/uploads" className="btn-secondary">Tillbaka</Link>
            {!done && (
              <form action={deleteUpload}>
                <input type="hidden" name="uploadId" value={u.id} />
                <ConfirmButton className="btn-danger" message="Ta bort underlaget?">Ta bort</ConfirmButton>
              </form>
            )}
          </>
        }
      />
      <Flash error={error} notice={notice} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          {u.mimeType === "application/pdf" ? (
            <PdfPreview src={src} maxPages={3} label={u.fileName} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={u.fileName} className="max-h-[70vh] w-full object-contain" />
          )}
        </Card>
        <Card>
          {done ? (
            <div className="p-4 text-sm">
              {u.verification && (
                <p>
                  Bokförd som{" "}
                  <Link href={`/verifications/${u.verification.id}`} className="text-brand">
                    {u.verification.series}{u.verification.number}
                  </Link>
                  .
                </p>
              )}
              {u.expense && !u.verification && (
                <p>
                  Registrerad som <Link href="/expenses" className="text-brand">utlägg</Link>.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="px-4 pt-4">
                <Segmented active={tab} items={TABS.map(([key, label]) => ({ key, label, href: `/uploads/${u.id}?tab=${key}` }))} />
              </div>
              <div className="p-4">
                {tab === "template" && (
                  <BookingWizard
                    templates={templates}
                    accounts={accounts}
                    noVat={company.vatPeriod === "none"}
                    manualAction={createManualVerification}
                    presetUploadIds={[u.id]}
                    back={`/uploads/${u.id}`}
                    allowManual={false}
                    ai={aiEnabled()}
                    presetAi={u.aiStatus === "done" && ((u.aiData as unknown as ReceiptData)?.version ?? 1) >= AI_VERSION ? (u.aiData as unknown as ReceiptData) : null}
                  />
                )}
                {tab === "manual" && (
                  <VerificationEditor accounts={accounts} action={createManualVerification} defaults={{ uploadId: u.id, description: u.fileName }} />
                )}
                {tab === "expense" && (
                  <form action={uploadAsExpense} className="grid gap-4 sm:grid-cols-2">
                    <input type="hidden" name="uploadId" value={u.id} />
                    <ExpenseFields accounts={accounts} />
                    <div className="flex justify-end sm:col-span-2">
                      <ConfirmButton>Registrera utlägg</ConfirmButton>
                    </div>
                  </form>
                )}
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
