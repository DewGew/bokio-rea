import { db } from "@/lib/db";
import { ADMIN_ACTIONS, dateTime, requireAdmin } from "@/lib/admin";
import { AdminTabs } from "@/components/AdminTabs";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AdminLog() {
  await requireAdmin();
  const rows = await db.adminLog.findMany({ orderBy: { id: "desc" }, take: 300 });
  return (
    <>
      <PageHeader title="Administration" subtitle="Alla administratörers åtgärder. Loggen kan inte ändras från appen. De senaste 300 raderna visas." />
      <AdminTabs active="/admin/log" />
      <Card title="Logg">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-[0.06em] text-muted">
                <th className="px-5 py-2">Tid</th>
                <th className="px-3 py-2">Administratör</th>
                <th className="px-3 py-2">Åtgärd</th>
                <th className="px-3 py-2">Gäller</th>
                <th className="px-5 py-2">Detaljer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-4 text-muted">Inga åtgärder har loggats än.</td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-5 py-2.5">{dateTime(r.createdAt)}</td>
                  <td className="px-3 py-2.5">{r.adminEmail}</td>
                  <td className="px-3 py-2.5">{ADMIN_ACTIONS[r.action] ?? r.action}</td>
                  <td className="px-3 py-2.5">{r.targetLabel || `${r.targetType} ${r.targetId ?? ""}`}</td>
                  <td className="px-5 py-2.5 text-muted">{r.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
