import Link from "next/link";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { dateStr, kr } from "@/lib/money";
import { Card, Empty, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { FileUploader } from "@/components/FileUploader";
import { directUploadEnabled, serverUploadLimit } from "@/lib/storage";

export default async function Uploads({ searchParams }: { searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { get, error, notice } = await readParams(searchParams);
  const showBooked = get("show") === "all";
  const uploads = await db.upload.findMany({
    where: showBooked ? { companyId } : { companyId, verificationId: null, expense: null },
    include: { verification: true, expense: true, inboundEmail: { select: { fromAddress: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <PageHeader
        title="Uppladdat"
        subtitle="Kvitton, leverantörsfakturor och andra underlag att bokföra"
        actions={<Link href="/settings/inbox" className="btn-secondary">Kvitton via e-post</Link>}
      />
      <Flash error={error} notice={notice} />

      <Card className="mb-6 p-4">
        <FileUploader blob={directUploadEnabled()} limit={serverUploadLimit()} companyId={companyId} />
      </Card>

      <Card
        title={showBooked ? "Alla underlag" : "Att bokföra"}
        action={
          <Link href={showBooked ? "/uploads" : "/uploads?show=all"} className="text-sm text-brand">
            {showBooked ? "Visa bara obokförda" : "Visa även bokförda"}
          </Link>
        }
      >
        {uploads.length === 0 ? (
          <Empty>Inga underlag att bokföra. Ladda upp ett kvitto ovan.</Empty>
        ) : (
          <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {uploads.map((u) => (
              <li key={u.id}>
                <Link href={`/uploads/${u.id}`} className="flex gap-3 rounded-lg border border-line p-3 hover:border-brand">
                  <div className="grid h-16 w-14 shrink-0 place-items-center overflow-hidden rounded bg-fill text-xs text-muted">
                    {u.mimeType.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/files/${u.id}`} alt="" className="h-full w-full object-cover" />
                    ) : u.mimeType === "text/plain" ? (
                      "MEJL"
                    ) : (
                      "PDF"
                    )}
                  </div>
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium">{u.description || u.fileName}</p>
                    <p className="text-muted">{u.amount != null ? kr(u.amount) : "Belopp saknas"}</p>
                    <p className="text-xs text-muted">
                      {u.verification
                        ? `Bokförd ${u.verification.series}${u.verification.number}`
                        : u.expense
                          ? "Registrerad som utlägg"
                          : u.inboundEmail
                            ? `Från e-post: ${u.inboundEmail.fromAddress}`
                            : `Uppladdad ${dateStr(u.createdAt)}`}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
