/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { dateStr, kr } from "@/lib/money";
import { Badge, Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { FileUploader } from "@/components/FileUploader";
import { PdfPreview } from "@/components/PdfPreview";
import { blobEnabled } from "@/lib/storage";
import { reverse } from "../actions";

export default async function VerificationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { id } = await params;
  const { error, notice } = await readParams(searchParams);
  const v = await db.verification.findFirst({
    where: { id: Number(id) || -1, companyId },
    include: {
      lines: { include: { account: true }, orderBy: { id: "asc" } },
      uploads: true,
      reversedBy: true,
      reverses: true,
      invoices: { select: { id: true, number: true } },
      invoicePays: { select: { id: true, number: true } },
    },
  });
  if (!v) notFound();
  const debit = v.lines.reduce((s, l) => s + l.debit, 0);
  const credit = v.lines.reduce((s, l) => s + l.credit, 0);
  const invoice = v.invoices[0] ?? v.invoicePays[0];

  return (
    <>
      <PageHeader
        title={`Verifikat ${v.series}${v.number}`}
        subtitle={`${dateStr(v.date)} · ${v.description}`}
        actions={
          <>
            <Link href="/verifications" className="btn-secondary">Tillbaka</Link>
            {!v.reversedById && !v.reverses && (
              <form action={reverse}>
                <input type="hidden" name="id" value={v.id} />
                <ConfirmButton className="btn-danger" message="Makulera verifikatet? Ett omvänt verifikat skapas.">Makulera</ConfirmButton>
              </form>
            )}
          </>
        }
      />
      <Flash error={error} notice={notice} />
      {v.reversedBy && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <Badge status="reversed" /> Makulerad av{" "}
          <Link className="text-brand" href={`/verifications/${v.reversedBy.id}`}>{v.reversedBy.series}{v.reversedBy.number}</Link>
        </div>
      )}
      {v.reverses && (
        <p className="mb-4 text-sm">
          Makulerar <Link className="text-brand" href={`/verifications/${v.reverses.id}`}>{v.reverses.series}{v.reverses.number}</Link>
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Konto</th>
                  <th>Benämning</th>
                  <th className="num">Debet</th>
                  <th className="num">Kredit</th>
                </tr>
              </thead>
              <tbody>
                {v.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link href={`/reports/ledger?account=${l.accountNumber}&year=${v.year}`} className="text-brand">{l.accountNumber}</Link>
                    </td>
                    <td>
                      {l.account.name}
                      {l.text && <span className="block text-xs text-muted">{l.text}</span>}
                    </td>
                    <td className="num">{l.debit ? kr(l.debit) : ""}</td>
                    <td className="num">{l.credit ? kr(l.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="px-3 py-2.5" colSpan={2}>Summa</td>
                  <td className="num px-3">{kr(debit)}</td>
                  <td className="num px-3">{kr(credit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
        <Card title="Underlag">
          <div className="space-y-4 px-5 pb-5 text-[14px]">
            {invoice && (
              <p>
                Kopplad till <Link className="text-brand" href={`/invoices/${invoice.id}`}>faktura #{invoice.number}</Link>
              </p>
            )}
            {v.uploads.length === 0 && !invoice && <p className="text-muted">Inget underlag bifogat.</p>}
            {v.uploads.map((u) => (
              <figure key={u.id} className="space-y-1.5">
                <a href={`/api/files/${u.id}`} target="_blank" className="block overflow-hidden rounded-xl bg-surface-2 ring-1 ring-line">
                  {u.mimeType === "application/pdf" ? (
                    <PdfPreview src={`/api/files/${u.id}`} maxPages={2} label={u.fileName} />
                  ) : (
                    <img src={`/api/files/${u.id}`} alt={u.fileName} className="w-full" />
                  )}
                </a>
                <figcaption className="flex items-center justify-between gap-2 text-[12px] text-muted">
                  <span className="truncate">{u.fileName}</span>
                  <a href={`/api/files/${u.id}?download`} className="shrink-0 text-brand">Ladda ner</a>
                </figcaption>
              </figure>
            ))}
            {!v.reverses && (
              <div>
                <p className="mb-2 text-[13px] font-medium text-muted">Bifoga fler underlag</p>
                <FileUploader compact blob={blobEnabled()} companyId={companyId} verificationId={v.id} />
              </div>
            )}
            <p className="text-[12px] text-muted">Skapad {v.createdAt.toLocaleString("sv-SE")}</p>
          </div>
        </Card>
      </div>
    </>
  );
}
