import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
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

  const companies = session.user.memberships.filter((m) => MCP_ROLES.includes(m.role));
  const hidden = Object.entries(oauth).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);

  return (
    <>
      <div className="mb-5 flex justify-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand">
          <Icon name="plug" className="h-6 w-6" />
        </span>
      </div>
      <h1 className="mb-2 text-center text-[24px] font-semibold tracking-[-0.02em]">{req.clientName} vill få åtkomst till Huvudbok</h1>
      <p className="mb-6 text-center text-[15px] text-muted">Inloggad som {session.user.email}</p>
      <Flash error={error} />

      {companies.length === 0 ? (
        <p className="rounded-xl bg-warn-soft p-3 text-[14px] text-warn">Du behöver vara ägare eller ha full behörighet i ett företag för att koppla det till {req.clientName}.</p>
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
          <div className="rounded-xl bg-surface-2 p-4 text-[14px]">
            <p className="mb-2 font-medium">{req.clientName} kommer att kunna</p>
            <ul className="space-y-1.5">
              {req.scope.split(" ").map((s) => (
                <li key={s} className="flex gap-2">
                  <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  {SCOPE_LABEL[s] ?? s}
                </li>
              ))}
              <li className="flex gap-2 text-muted">
                <Icon name="x" className="mt-0.5 h-4 w-4 shrink-0" />
                Inte bokföra, ändra eller ta bort något
              </li>
            </ul>
          </div>
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
