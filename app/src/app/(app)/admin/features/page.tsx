import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { FEATURES, FEATURE_KEYS, globalSwitches } from "@/lib/features";
import { AdminTabs } from "@/components/AdminTabs";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Card, Flash, PageHeader, readParams, Stat, type SP } from "@/components/ui";
import { setFeatureSwitch } from "../actions";

export const dynamic = "force-dynamic";

export default async function AdminFeatures({ searchParams }: { searchParams: SP }) {
  await requireAdmin();
  const { notice, error } = await readParams(searchParams);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [switches, pro, free, aiReads, grants, mails] = await Promise.all([
    globalSwitches(),
    db.company.count({ where: { plan: "pro" } }),
    db.company.count({ where: { plan: { not: "pro" } } }),
    db.upload.count({ where: { aiStatus: "done", createdAt: { gte: since } } }),
    db.oAuthGrant.count({ where: { revokedAt: null } }),
    db.inboundEmail.count({ where: { createdAt: { gte: since }, status: { in: ["ok", "no_attachment"] } } }),
  ]);
  const usage: Record<string, string> = {
    ai: `${aiReads} avläsningar senaste 30 dagarna`,
    mcp: `${grants} aktiva kopplingar`,
    inbound: `${mails} mottagna mejl senaste 30 dagarna`,
  };

  return (
    <>
      <PageHeader title="Administration" subtitle="Funktioner som ingår i Pro. Ett företag med Pro får dem, och varje funktion kan dessutom stängas av för hela appen." />
      <AdminTabs active="/admin/features" />
      <Flash notice={notice} error={error} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Stat label="Företag med Pro" value={String(pro)} tone="brand" />
        <Stat label="Gratisföretag" value={String(free)} />
      </div>

      <Card title="Funktioner">
        <ul className="divide-y divide-line">
          {FEATURE_KEYS.map((f) => {
            const on = switches[f];
            return (
              <li key={f} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1 text-[14px]">
                  <p className="text-[15px] font-medium">
                    {FEATURES[f].label} <span className={on ? "text-success" : "text-danger"}>{on ? "● På" : "● Avstängd för alla"}</span>
                  </p>
                  <p className="text-muted">{FEATURES[f].description}</p>
                  <p className="text-[13px] text-muted">{usage[f]}</p>
                </div>
                <form action={setFeatureSwitch}>
                  <input type="hidden" name="feature" value={f} />
                  <input type="hidden" name="on" value={on ? "0" : "1"} />
                  <ConfirmButton className={on ? "btn-danger" : "btn-secondary"} message={on ? `Stänga av ${FEATURES[f].label} för alla företag?` : `Slå på ${FEATURES[f].label} igen?`}>
                    {on ? "Stäng av" : "Slå på"}
                  </ConfirmButton>
                </form>
              </li>
            );
          })}
        </ul>
        <p className="px-5 pb-4 text-[13px] text-muted">
          Strömbrytaren gäller hela appen och används vid driftstörningar eller kostnadsproblem. Företag med Pro får funktionen igen när den slås på.
          Abonnemanget sätts per företag på företagets adminsida.
        </p>
      </Card>
    </>
  );
}
