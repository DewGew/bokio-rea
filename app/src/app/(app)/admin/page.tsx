import Link from "next/link";
import { db } from "@/lib/db";
import { dateTime, isAdminEmail, requireAdmin } from "@/lib/admin";
import { dateStr } from "@/lib/money";
import { Card, Flash, PageHeader, readParams, Stat, type SP } from "@/components/ui";
import { planLabel } from "@/lib/features";
import { AdminTabs } from "@/components/AdminTabs";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ResetLinkForm } from "@/components/ResetLinkForm";
import { endUserSessions, lockUser, resetUserMfa, unlockUser } from "./actions";

export const dynamic = "force-dynamic";

export default async function Admin({ searchParams }: { searchParams: SP }) {
  const me = await requireAdmin();
  const { notice, error } = await readParams(searchParams);
  const [companies, users, sessions, verifications, invoices] = await Promise.all([
    db.company.findMany({ orderBy: { id: "asc" }, include: { _count: { select: { memberships: true } } } }),
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
      <PageHeader title="Administration" subtitle="Översikt över företag och användare. Du ser bara uppgifter om konton och mängder, aldrig innehållet i någons bokföring." />
      <AdminTabs active="/admin" />
      <Flash notice={notice} error={error} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Företag" value={String(companies.length)} />
        <Stat label="Användare" value={String(users.length)} />
        <Stat label="Aktiva sessioner" value={String(sessions)} />
      </div>

      <div className="space-y-6">
        <Card title="Användare">
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-left text-[12px] uppercase tracking-[0.06em] text-muted">
                  <th className="px-5 py-2">Namn</th>
                  <th className="px-3 py-2">E-post</th>
                  <th className="px-3 py-2">Företag</th>
                  <th className="px-3 py-2">Senast aktiv</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-5 py-2">Åtgärder</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line align-top">
                {users.map((u) => {
                  const protectedAdmin = isAdminEmail(u.email);
                  return (
                    <tr key={u.id}>
                      <td className="px-5 py-2.5 font-medium">{u.name}</td>
                      <td className="px-3 py-2.5">{u.email}</td>
                      <td className="px-3 py-2.5">{u.memberships.map((m) => `${m.company.name} (${m.role})`).join(", ") || "–"}</td>
                      <td className="px-3 py-2.5">{u.sessions[0] ? dateTime(u.sessions[0].lastSeenAt) : "–"}</td>
                      <td className="px-3 py-2.5">
                        {u.lockedAt ? <span className="text-warn" title={u.lockedReason}>Låst {dateStr(u.lockedAt)}</span> : protectedAdmin ? "Administratör" : "Aktiv"}
                        <div className="text-[12px] text-muted">{u.mfaEnabledAt ? "MFA på" : "Ingen MFA"}</div>
                      </td>
                      <td className="space-y-1.5 px-5 py-2.5">
                        <ResetLinkForm userId={u.id} />
                        {u.mfaEnabledAt && u.email !== me.user.email && (
                          <form action={resetUserMfa}>
                            <input type="hidden" name="userId" value={u.id} />
                            <ConfirmButton className="text-[13px] text-brand hover:underline" message={`Återställa tvåfaktor för ${u.email}? Användaren loggas ut.`}>Återställ MFA</ConfirmButton>
                          </form>
                        )}
                        <form action={endUserSessions}>
                          <input type="hidden" name="userId" value={u.id} />
                          <ConfirmButton className="text-[13px] text-brand hover:underline" message={`Logga ut ${u.email} på alla enheter?`}>Logga ut överallt</ConfirmButton>
                        </form>
                        {u.lockedAt ? (
                          <form action={unlockUser}>
                            <input type="hidden" name="userId" value={u.id} />
                            <ConfirmButton className="text-[13px] text-brand hover:underline" message={`Låsa upp ${u.email}?`}>Lås upp</ConfirmButton>
                          </form>
                        ) : (
                          !protectedAdmin && (
                            <form action={lockUser} className="flex items-center gap-2">
                              <input type="hidden" name="userId" value={u.id} />
                              <input name="reason" placeholder="Orsak (loggas)" maxLength={200} className="input w-36 text-[12px]" />
                              <ConfirmButton className="text-[13px] text-warn hover:underline" message={`Låsa ${u.email}? Användaren får bara läsrätt i alla sina företag.`}>Lås</ConfirmButton>
                            </form>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Företag">
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-left text-[12px] uppercase tracking-[0.06em] text-muted">
                  <th className="px-5 py-2">Namn</th>
                  <th className="px-3 py-2">Org.nr</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2">Användare</th>
                  <th className="px-3 py-2">Verifikationer</th>
                  <th className="px-3 py-2">Fakturor</th>
                  <th className="px-5 py-2">Skapat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {companies.map((c) => (
                  <tr key={c.id}>
                    <td className="px-5 py-2.5 font-medium">
                      <Link href={`/admin/companies/${c.id}`} className="text-brand">{c.name}</Link>
                    </td>
                    <td className="px-3 py-2.5">{c.orgNumber}</td>
                    <td className="px-3 py-2.5">{planLabel(c.plan)}</td>
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
      </div>
    </>
  );
}
