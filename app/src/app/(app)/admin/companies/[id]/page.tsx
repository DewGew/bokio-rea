import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { dateTime, requireAdmin } from "@/lib/admin";
import { fyLabel } from "@/lib/fiscal";
import { dateStr } from "@/lib/money";
import { Card, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} MB`;

/** Företagsdetaljer för administratörer: bara metadata och mängder, aldrig innehållet i bokföringen. */
export default async function AdminCompany({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const company = await db.company.findUnique({
    where: { id },
    select: {
      id: true, name: true, orgNumber: true, companyType: true, vatPeriod: true, createdAt: true,
      memberships: { select: { role: true, user: { select: { name: true, email: true, disabledAt: true } } }, orderBy: { userId: "asc" } },
      fiscalYears: { select: { id: true, start: true, end: true }, orderBy: { start: "asc" } },
    },
  });
  if (!company) notFound();

  const [perYear, sieExports, invoices, issued, customers, uploads] = await Promise.all([
    db.verification.groupBy({ by: ["fiscalYearId"], where: { companyId: id }, _count: { _all: true }, _max: { createdAt: true } }),
    db.sieExport.findMany({ where: { companyId: id }, select: { fiscalYearId: true, exportedAt: true } }),
    db.invoice.count({ where: { companyId: id } }),
    db.invoice.count({ where: { companyId: id, number: { not: null } } }),
    db.customer.count({ where: { companyId: id } }),
    db.upload.aggregate({ where: { companyId: id }, _count: { _all: true }, _sum: { size: true } }),
  ]);
  const ver = new Map(perYear.map((y) => [y.fiscalYearId, y]));
  const exp = new Map(sieExports.map((e) => [e.fiscalYearId, e.exportedAt]));
  const totalVer = perYear.reduce((n, y) => n + y._count._all, 0);
  const lastActivity = perYear.reduce<Date | null>((m, y) => (y._max.createdAt && (!m || y._max.createdAt > m) ? y._max.createdAt : m), null);

  return (
    <>
      <PageHeader title={company.name} subtitle={`Org.nr ${company.orgNumber} · skapat ${dateStr(company.createdAt)}`} />
      <div className="mb-4 text-[14px]">
        <Link href="/admin" className="text-brand">← Tillbaka till översikten</Link>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Verifikationer" value={String(totalVer)} />
        <Stat label="Fakturor (utfärdade)" value={`${invoices} (${issued})`} />
        <Stat label="Kunder" value={String(customers)} />
        <Stat label="Uppladdade filer" value={`${uploads._count._all} · ${mb(uploads._sum.size ?? 0)}`} />
      </div>

      <div className="space-y-6">
        <Card title="Användare">
          <table className="w-full text-[14px]">
            <tbody className="divide-y divide-line">
              {company.memberships.map((m) => (
                <tr key={m.user.email}>
                  <td className="px-5 py-2.5 font-medium">{m.user.name}</td>
                  <td className="px-3 py-2.5">{m.user.email}</td>
                  <td className="px-3 py-2.5">{m.role}</td>
                  <td className="px-5 py-2.5">{m.user.disabledAt ? <span className="text-danger">Spärrad</span> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Räkenskapsår">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-[0.06em] text-muted">
                <th className="px-5 py-2">År</th>
                <th className="px-3 py-2">Verifikationer</th>
                <th className="px-3 py-2">Senaste bokföring</th>
                <th className="px-5 py-2">SIE-export</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {company.fiscalYears.map((y) => {
                const v = ver.get(y.id);
                const at = exp.get(y.id);
                const current = !v || (!!at && (!v._max.createdAt || at >= v._max.createdAt));
                return (
                  <tr key={y.id}>
                    <td className="px-5 py-2.5 font-medium">{fyLabel(y)}</td>
                    <td className="px-3 py-2.5">{v?._count._all ?? 0}</td>
                    <td className="px-3 py-2.5">{v?._max.createdAt ? dateTime(v._max.createdAt) : "–"}</td>
                    <td className="px-5 py-2.5">{!v ? "–" : at ? `${dateTime(at)}${current ? "" : " (föråldrad)"}` : "Ej exporterad"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {lastActivity && <p className="px-5 pb-4 text-[13px] text-muted">Senast bokfört: {dateTime(lastActivity)}</p>}
        </Card>
      </div>
    </>
  );
}
