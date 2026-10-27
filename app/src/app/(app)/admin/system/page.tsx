import { dateTime, requireAdmin } from "@/lib/admin";
import { activitySummary, configStatus, databaseStatus, errorOverview } from "@/lib/admin-system";
import { pingStorage } from "@/lib/storage";
import { AdminTabs } from "@/components/AdminTabs";
import { Card, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

const dot = (ok: boolean) => <span className={ok ? "text-success" : "text-danger"}>{ok ? "● OK" : "● Fel"}</span>;

export default async function AdminSystem() {
  await requireAdmin();
  const [dbs, storage, activity, errors] = await Promise.all([databaseStatus(), pingStorage(), activitySummary(), errorOverview()]);
  const config = configStatus();
  const totals = errors.days.reduce((t, d) => ({ login: t.login + d.login, inbound: t.inbound + d.inbound, storage: t.storage + d.storage, ai: t.ai + d.ai }), { login: 0, inbound: 0, storage: 0, ai: 0 });

  return (
    <>
      <PageHeader title="Administration" subtitle="Driftstatus och fel. Inga företags uppgifter visas, bara systemets tillstånd." />
      <AdminTabs active="/admin/system" />

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Databas" value={dbs.ok ? `${dbs.ms} ms` : "Fel"} tone={dbs.ok ? "success" : "danger"} />
        <Stat label="Fillagring" value={storage.ok ? "OK" : "Fel"} hint={storage.backend} tone={storage.ok ? "success" : "danger"} />
        <Stat label="Aktiva sessioner" value={String(activity.activeSessions)} />
        <Stat label="Misslyckade inloggningar (14 d)" value={String(totals.login)} tone={totals.login > 50 ? "warn" : undefined} />
      </div>

      <div className="space-y-6">
        <Card title="Status">
          <table className="w-full text-[14px]">
            <tbody className="divide-y divide-line">
              <tr>
                <td className="px-5 py-2.5 font-medium">Databas</td>
                <td className="px-3 py-2.5">{dot(dbs.ok)}</td>
                <td className="px-5 py-2.5 text-muted">
                  {dbs.ok ? `${dbs.ms} ms` : dbs.error}
                  {dbs.lastMigration && ` · senaste migrering ${dbs.lastMigration} (${dateTime(dbs.lastMigrationAt!)})`}
                  {dbs.failedMigrations ? ` · ${dbs.failedMigrations} misslyckade migreringar` : ""}
                </td>
              </tr>
              <tr>
                <td className="px-5 py-2.5 font-medium">Fillagring</td>
                <td className="px-3 py-2.5">{dot(storage.ok)}</td>
                <td className="px-5 py-2.5 text-muted">{storage.backend}: {storage.message}</td>
              </tr>
              <tr>
                <td className="px-5 py-2.5 font-medium">Senaste inkommande mejl</td>
                <td className="px-3 py-2.5" />
                <td className="px-5 py-2.5 text-muted">{activity.lastInbound ? `${dateTime(activity.lastInbound.createdAt)} (${activity.lastInbound.status})` : "Inget än"}</td>
              </tr>
              <tr>
                <td className="px-5 py-2.5 font-medium">Senaste lyckade AI-avläsning</td>
                <td className="px-3 py-2.5" />
                <td className="px-5 py-2.5 text-muted">{activity.lastAi ? dateTime(activity.lastAi.createdAt) : "Ingen än"}</td>
              </tr>
            </tbody>
          </table>
        </Card>

        <Card title="Inställningar">
          <table className="w-full text-[14px]">
            <tbody className="divide-y divide-line">
              {config.map((c) => (
                <tr key={c.name}>
                  <td className="px-5 py-2.5 font-medium">{c.name}</td>
                  <td className="px-3 py-2.5">{dot(c.ok)}</td>
                  <td className="px-5 py-2.5 text-muted">{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-5 pb-4 text-[13px] text-muted">Värden visas aldrig, bara om inställningen finns.</p>
        </Card>

        <Card title="Fel per dag (14 dagar)">
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-left text-[12px] uppercase tracking-[0.06em] text-muted">
                  <th className="px-5 py-2">Dag</th>
                  <th className="px-3 py-2">Misslyckade inloggningar</th>
                  <th className="px-3 py-2">Fel vid inkommande mejl</th>
                  <th className="px-3 py-2">Lagringsfel vid mejl</th>
                  <th className="px-5 py-2">Fel vid AI-avläsning</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {errors.days.map((d) => (
                  <tr key={d.day}>
                    <td className="px-5 py-2.5">{d.day}</td>
                    <td className="px-3 py-2.5">{d.login}</td>
                    <td className="px-3 py-2.5">{d.inbound}</td>
                    <td className="px-3 py-2.5">{d.storage}</td>
                    <td className="px-5 py-2.5">{d.ai}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="px-5 py-2.5">Summa</td>
                  <td className="px-3 py-2.5">{totals.login}</td>
                  <td className="px-3 py-2.5">{totals.inbound}</td>
                  <td className="px-3 py-2.5">{totals.storage}</td>
                  <td className="px-5 py-2.5">{totals.ai}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Senaste fel">
          <table className="w-full text-[14px]">
            <tbody className="divide-y divide-line align-top">
              {errors.latestEvents.map((e) => (
                <tr key={`e${e.id}`}>
                  <td className="whitespace-nowrap px-5 py-2.5">{dateTime(e.createdAt)}</td>
                  <td className="px-3 py-2.5">{e.kind === "login_failed" ? "Misslyckad inloggning" : "Lagringsfel (mejl)"}</td>
                  <td className="px-5 py-2.5 text-muted">{e.detail}</td>
                </tr>
              ))}
              {errors.latestInbound.map((e, i) => (
                <tr key={`i${i}`}>
                  <td className="whitespace-nowrap px-5 py-2.5">{dateTime(e.createdAt)}</td>
                  <td className="px-3 py-2.5">Inkommande mejl</td>
                  <td className="px-5 py-2.5 text-muted">{e.company.name}: {e.detail}</td>
                </tr>
              ))}
              {errors.latestAi.map((e, i) => (
                <tr key={`a${i}`}>
                  <td className="whitespace-nowrap px-5 py-2.5">{dateTime(e.createdAt)}</td>
                  <td className="px-3 py-2.5">AI-avläsning</td>
                  <td className="px-5 py-2.5 text-muted">{e.company.name}: {e.aiError}</td>
                </tr>
              ))}
              {errors.latestEvents.length + errors.latestInbound.length + errors.latestAi.length === 0 && (
                <tr>
                  <td className="px-5 py-4 text-muted">Inga fel registrerade.</td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="px-5 pb-4 text-[13px] text-muted">Misslyckade inloggningar och lagringsfel sparas i 30 dagar.</p>
        </Card>
      </div>
    </>
  );
}
