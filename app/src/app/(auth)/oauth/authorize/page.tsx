import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { featureState, globalSwitches } from "@/lib/features";
import { MCP_ROLES, SCOPE_LABEL, checkAuthorize, headerOrigin } from "@/lib/oauth";
import { ROLES, type Role } from "@/lib/session-config";
import { Flash, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Icon } from "@/components/Icon";
import { approveConsent, denyConsent } from "./actions";

export default async function Authorize({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const p = Object.fromEntries(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))) as Record<string, string>;
  const { error, ...oauth } = p;

  // Inte inloggad (eller utloggad efter inaktivitet): logga in och kom tillbaka hit.
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${new URLSearchParams(oauth)}`)}`);

  const req = await checkAuthorize(oauth, await headerOrigin());
  if ("redirect" in req) redirect(req.redirect);
  if ("fatal" in req) {
    return (
      <>
        <h1 className="mb-2 text-center text-[24px] font-semibold tracking-[-0.02em]">Kopplingen kan inte godkännas</h1>
        <Flash error={req.fatal} />
      </>
    );
  }

  const switches = await globalSwitches();
  const companies = session.user.memberships.filter((m) => MCP_ROLES.includes(m.role) && featureState(m.company.plan, switches, "mcp").available);
  const hidden = Object.entries(oauth).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);

  return (
    <>
      <div className="mb-5 flex justify-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand">
          <Icon name="plug" className="h-6 w-6" />
        </span>
      </div>
      <h1 className="mb-2 text-center text-[24px] font-semibold tracking-[-0.02em]">{req.clientName} vill få åtkomst till Kapima Bokför</h1>
      <p className="mb-6 text-center text-[15px] text-muted">Inloggad som {session.user.email}</p>
      <Flash error={error} />

      {companies.length === 0 ? (
        <p className="rounded-xl bg-warn-soft p-3 text-[14px] text-warn">Du behöver vara ägare eller ha full behörighet i ett företag med Pro för att koppla det till {req.clientName}. Koppling till AI-assistent ingår i Pro.</p>
      ) : (
        <form action={approveConsent} className="space-y-5">
          {hidden}
          <div>
            <label className="label" htmlFor="companyId">Företag</label>
            <select id="companyId" name="companyId" className="input" defaultValue={session.activeCompanyId ?? companies[0].companyId}>
              {companies.map((m) => (
                <option key={m.companyId} value={m.companyId}>
                  {m.company.name} ({ROLES[m.role as Role]?.label.toLowerCase()})
                </option>
              ))}
            </select>
          </div>
          <fieldset className="space-y-2 text-[14px]">
            <legend className="label">Vad får {req.clientName} göra?</legend>
            {(
              [
                ["read", "Läsa", [SCOPE_LABEL.read], "Inte bokföra, ändra eller ta bort något"],
                ["write", "Läsa och bokföra", [SCOPE_LABEL.read, SCOPE_LABEL.write], "Inte ta bort eller makulera något. Allt som skapas märks med \"Skapad via\"."],
              ] as const
            ).map(([value, title, can, cannot]) => (
              <label
                key={value}
                className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-2 p-3 ring-1 ring-transparent transition has-[:checked]:bg-brand-soft has-[:checked]:ring-brand"
              >
                <input type="radio" name="level" value={value} defaultChecked={value === "read"} className="mt-1 h-4 w-4 accent-[var(--brand)]" />
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium">{title}</span>
                  <span className="mt-1 block space-y-1">
                    {can.map((c) => (
                      <span key={c} className="flex gap-2">
                        <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                        {c}
                      </span>
                    ))}
                    <span className="flex gap-2 text-muted">
                      <Icon name="x" className="mt-0.5 h-4 w-4 shrink-0" />
                      {cannot}
                    </span>
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-[13px] text-muted">Du kan när som helst koppla från under Inställningar → Kopplingar. Ditt lösenord delas aldrig.</p>
          <div className="grid grid-cols-2 gap-2">
            <button formAction={denyConsent} formNoValidate className="btn-secondary">
              Avbryt
            </button>
            <ConfirmButton className="btn-primary">Godkänn</ConfirmButton>
          </div>
        </form>
      )}
    </>
  );
}
