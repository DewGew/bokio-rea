import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { dateStr } from "@/lib/money";
import { Card, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Admin() {
  await requireAdmin();
  const [companies, users, sessions, verifications, invoices] = await Promise.all([
    db.company.findMany({
      orderBy: { id: "asc" },
      include: { _count: { select: { memberships: true } } },
    }),
    db.user.findMany({
      orderBy: { id: "asc" },
      include: {
        memberships: { include: { company: { select: { name: true } } } },
        sessions: { select: { lastSeenAt: true }, orderBy: { lastSeenAt: "desc" }, take: 1 },
      },
    }),
    db.session.count({ where: { expiresAt: { gt: new Date() } } }),
    db.verification.groupBy({ by: ["companyId"], _count: { _all: true } }),
    db.invoice.groupBy({ by: ["companyId"], _count: { _all: true } }),
  ]);
  const verCount = new Map(verifications.map((v) => [v.companyId, v._count._all]));
  const invCount = new Map(invoices.map((v) => [v.companyId, v._count._all]));

  return (
    <>
      <PageHeader title="Administration" subtitle="Översikt över alla företag och användare i systemet. Endast läsning." />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Företag" value={String(companies.length)} />
        <Stat label="Användare" value={String(users.length)} />
        <Stat label="Aktiva sessioner" value={String(sessions)} />
      </div>

      <div className="space-y-6">
        <Card title="Företag">
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-left text-[12px] uppercase tracking-[0.06em] text-muted">
                  <th className="px-5 py-2">Namn</th>
                  <th className="px-3 py-2">Org.nr</th>
                  <th className="px-3 py-2">Användare</th>
                  <th className="px-3 py-2">Verifikationer</th>
                  <th className="px-3 py-2">Fakturor</th>
                  <th className="px-5 py-2">Skapat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {companies.map((c) => (
                  <tr key={c.id}>
                    <td className="px-5 py-2.5 font-medium">{c.name}</td>
                    <td className="px-3 py-2.5">{c.orgNumber}</td>
                    <td className="px-3 py-2.5">{c._count.memberships}</td>
                    <td className="px-3 py-2.5">{verCount.get(c.id) ?? 0}</td>
                    <td className="px-3 py-2.5">{invCount.get(c.id) ?? 0}</td>
                    <td className="px-5 py-2.5">{dateStr(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Användare">
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-left text-[12px] uppercase tracking-[0.06em] text-muted">
                  <th className="px-5 py-2">Namn</th>
                  <th className="px-3 py-2">E-post</th>
                  <th className="px-3 py-2">Företag</th>
                  <th className="px-3 py-2">Senast aktiv</th>
                  <th className="px-5 py-2">Skapad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-5 py-2.5 font-medium">{u.name}</td>
                    <td className="px-3 py-2.5">{u.email}</td>
                    <td className="px-3 py-2.5">
                      {u.memberships.map((m) => `${m.company.name} (${m.role})`).join(", ") || "–"}
                    </td>
                    <td className="px-3 py-2.5">{u.sessions[0] ? dateStr(u.sessions[0].lastSeenAt) : "–"}</td>
                    <td className="px-5 py-2.5">{dateStr(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
