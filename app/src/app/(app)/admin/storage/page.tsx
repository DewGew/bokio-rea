import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { findOrphans } from "@/lib/admin-system";
import { AdminTabs } from "@/components/AdminTabs";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Card, Flash, PageHeader, readParams, Stat, type SP } from "@/components/ui";
import { deleteOrphans } from "../actions";

export const dynamic = "force-dynamic";

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} MB`;

export default async function AdminStorage({ searchParams }: { searchParams: SP }) {
  await requireAdmin();
  const { get, notice, error } = await readParams(searchParams);
  const scan = get("scan") === "1";
  const [total, perCompany, companies, orphanScan] = await Promise.all([
    db.upload.aggregate({ _count: { _all: true }, _sum: { size: true } }),
    db.upload.groupBy({ by: ["companyId"], _count: { _all: true }, _sum: { size: true }, orderBy: { _sum: { size: "desc" } }, take: 20 }),
    db.company.findMany({ select: { id: true, name: true } }),
    scan ? findOrphans().catch((e: Error) => ({ error: e.message })) : null,
  ]);
  const names = new Map(companies.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeader title="Administration" subtitle="Hur mycket lagring som används. Bara mängder, aldrig filernas innehåll." />
      <AdminTabs active="/admin/storage" />
      <Flash notice={notice} error={error} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Uppladdade filer" value={String(total._count._all)} />
        <Stat label="Total storlek" value={mb(total._sum.size ?? 0)} />
        <Stat label="Genomsnitt per fil" value={total._count._all ? mb((total._sum.size ?? 0) / total._count._all) : "–"} />
      </div>

      <div className="space-y-6">
        <Card title="Störst lagringsanvändning (20 företag)">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-[0.06em] text-muted">
                <th className="px-5 py-2">Företag</th>
                <th className="px-3 py-2">Filer</th>
                <th className="px-5 py-2">Storlek</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {perCompany.map((r) => (
                <tr key={r.companyId}>
                  <td className="px-5 py-2.5 font-medium">
                    <Link href={`/admin/companies/${r.companyId}`} className="text-brand">{names.get(r.companyId) ?? `Företag ${r.companyId}`}</Link>
                  </td>
                  <td className="px-3 py-2.5">{r._count._all}</td>
                  <td className="px-5 py-2.5">{mb(r._sum.size ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Föräldralösa filer">
          <div className="space-y-3 px-5 pb-5 pt-1 text-[14px]">
            <p className="text-muted">
              Filer som finns i lagringen men inte i databasen, till exempel efter en avbruten uppladdning. Bara filer äldre än ett dygn räknas, så att
              pågående uppladdningar inte påverkas. Genomsökningen går igenom hela lagringen och kan ta en stund.
            </p>
            {!scan && <Link href="/admin/storage?scan=1" className="btn-secondary inline-flex">Sök föräldralösa filer</Link>}
            {orphanScan && "error" in orphanScan && <p className="text-danger">Genomsökningen misslyckades: {orphanScan.error}</p>}
            {orphanScan && !("error" in orphanScan) && (
              <>
                <p>
                  {orphanScan.total} filer i lagringen ({mb(orphanScan.totalSize)}). <strong>{orphanScan.orphans.length}</strong> är föräldralösa
                  ({mb(orphanScan.orphans.reduce((n, f) => n + f.size, 0))}).
                </p>
                {orphanScan.orphans.length > 0 && (
                  <form action={deleteOrphans}>
                    <ConfirmButton className="btn-danger" message={`Ta bort ${orphanScan.orphans.length} föräldralösa filer permanent?`}>Ta bort föräldralösa filer</ConfirmButton>
                  </form>
                )}
              </>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
