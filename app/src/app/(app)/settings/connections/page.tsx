import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { MCP_ROLES, SCOPE_LABEL, headerOrigin, mcpResource } from "@/lib/oauth";
import { dateStr } from "@/lib/money";
import { Card, Empty, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { CopyField } from "@/components/CopyField";
import { revokeConnectionAction } from "./actions";

const when = (d: Date | null) => (d ? d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Stockholm" }) : "Aldrig");

export default async function Connections({ searchParams }: { searchParams: SP }) {
  const { error, notice } = await readParams(searchParams);
  const { companyId, company, role, user } = await requireCompany();
  const url = mcpResource(await headerOrigin());
  const grants = await db.oAuthGrant.findMany({
    where: { companyId, revokedAt: null },
    include: { client: { select: { name: true } }, user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <PageHeader title="Kopplingar" subtitle={`Ge Claude åtkomst till ${company.name} och fråga om bokföringen med vanliga ord.`} />
      <Flash error={error} notice={notice} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title="Aktiva kopplingar">
          {grants.length === 0 ? (
            <Empty>Inga kopplingar ännu. Följ stegen till höger för att koppla Claude.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {grants.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1 text-[14px]">
                    <p className="text-[15px] font-medium">{g.client.name}</p>
                    <p className="text-muted">
                      Godkänd av {g.userId === user.id ? "dig" : g.user.name} {dateStr(g.createdAt)} · {g.scope.split(" ").map((s) => SCOPE_LABEL[s] ?? s).join(", ")}
                    </p>
                    <p className="text-[13px] text-muted">Senast använd: {when(g.lastUsedAt)}</p>
                  </div>
                  {(role === "owner" || g.userId === user.id) && (
                    <form action={revokeConnectionAction}>
                      <input type="hidden" name="id" value={g.id} />
                      <ConfirmButton className="btn-danger py-1.5 text-[14px]" message={`Koppla från ${g.client.name}? Den kan då inte längre läsa något i ${company.name}.`}>
                        Koppla från
                      </ConfirmButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Koppla Claude">
          <div className="space-y-4 px-5 pb-5 pt-1 text-[14px]">
            {MCP_ROLES.includes(role) ? (
              <>
                <ol className="list-decimal space-y-2 pl-5">
                  <li>
                    Öppna Claude (Desktop eller claude.ai) och gå till <strong>Inställningar → Kopplingar</strong> (Connectors).
                  </li>
                  <li>
                    Välj <strong>Lägg till anpassad koppling</strong>, ge den namnet Huvudbok och klistra in adressen:
                  </li>
                </ol>
                <CopyField value={url} />
                <ol start={3} className="list-decimal space-y-2 pl-5">
                  <li>
                    Klicka på <strong>Anslut</strong>. Du kommer hit, loggar in, väljer företag och godkänner.
                  </li>
                  <li>Fråga Claude t.ex. &quot;Hur går det för företaget i år?&quot; eller &quot;Vilka fakturor är förfallna?&quot;.</li>
                </ol>
                <p className="text-muted">Kopplingen kan bara läsa. Den slutar fungera direkt om du kopplar från här eller om din behörighet ändras.</p>
              </>
            ) : (
              <p className="text-muted">Du behöver vara ägare eller ha full behörighet för att koppla Claude till företaget.</p>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
