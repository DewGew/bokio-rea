import { db } from "@/lib/db";
import { dateTime, requireAdmin } from "@/lib/admin";
import { AdminTabs } from "@/components/AdminTabs";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { revokeGrantAdmin } from "../actions";

export const dynamic = "force-dynamic";

export default async function AdminConnections({ searchParams }: { searchParams: SP }) {
  await requireAdmin();
  const { notice, error } = await readParams(searchParams);
  const grants = await db.oAuthGrant.findMany({
    orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { lastUsedAt: { sort: "desc", nulls: "last" } }],
    take: 300,
    include: { client: { select: { name: true } }, user: { select: { email: true } }, company: { select: { name: true } } },
  });
  const active = grants.filter((g) => !g.revokedAt).length;

  return (
    <>
      <PageHeader title="Administration" subtitle="Externa program (till exempel Claude via MCP) som har åtkomst till ett företag på en användares uppdrag." />
      <AdminTabs active="/admin/connections" />
      <Flash notice={notice} error={error} />
      <Card title={`Kopplingar (${active} aktiva)`}>
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-[0.06em] text-muted">
                <th className="px-5 py-2">Program</th>
                <th className="px-3 py-2">Användare</th>
                <th className="px-3 py-2">Företag</th>
                <th className="px-3 py-2">Skapad</th>
                <th className="px-3 py-2">Senast använd</th>
                <th className="px-5 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {grants.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-4 text-muted">Inga kopplingar.</td>
                </tr>
              )}
              {grants.map((g) => (
                <tr key={g.id}>
                  <td className="px-5 py-2.5 font-medium">{g.client.name}</td>
                  <td className="px-3 py-2.5">{g.user.email}</td>
                  <td className="px-3 py-2.5">{g.company.name}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">{dateTime(g.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">{g.lastUsedAt ? dateTime(g.lastUsedAt) : "Aldrig"}</td>
                  <td className="px-5 py-2.5">
                    {g.revokedAt ? (
                      <span className="text-muted">Återkallad {dateTime(g.revokedAt)}</span>
                    ) : (
                      <form action={revokeGrantAdmin}>
                        <input type="hidden" name="grantId" value={g.id} />
                        <ConfirmButton className="text-[13px] text-danger hover:underline" message={`Återkalla kopplingen för ${g.user.email}?`}>Återkalla</ConfirmButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
