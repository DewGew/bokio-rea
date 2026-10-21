import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { dateStr } from "@/lib/money";
import { ROLES, type Role } from "@/lib/session-config";
import { Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { InviteForm } from "@/components/InviteForm";
import { changeRoleAction, removeMemberAction, revokeInvitationAction } from "./actions";

export default async function Users({ searchParams }: { searchParams: SP }) {
  const { error, notice } = await readParams(searchParams);
  const { companyId, company, role, user } = await requireCompany();
  const owner = role === "owner";
  const [members, invitations] = await Promise.all([
    db.membership.findMany({ where: { companyId }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { userId: "asc" } }),
    db.invitation.findMany({ where: { companyId, acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <>
      <PageHeader title="Användare och behörighet" subtitle={`Vilka som har tillgång till ${company.name}. Bjud in din revisor eller redovisningskonsult.`} />
      <Flash error={error} notice={notice} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card title="Användare">
            <ul className="divide-y divide-line">
              {members.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-fill text-[14px] font-semibold">
                    {m.user.name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium">
                      {m.user.name}
                      {m.userId === user.id && <span className="ml-2 text-[13px] font-normal text-muted">(du)</span>}
                    </p>
                    <p className="truncate text-[13px] text-muted">{m.user.email}</p>
                  </div>
                  {owner ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={changeRoleAction} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={m.userId} />
                        <select name="role" aria-label={`Behörighet för ${m.user.name}`} defaultValue={m.role} className="input w-auto py-1.5 text-[14px]">
                          {Object.entries(ROLES).map(([k, r]) => (
                            <option key={k} value={k}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                        <ConfirmButton className="btn-secondary py-1.5 text-[14px]">Spara</ConfirmButton>
                      </form>
                      {m.userId !== user.id && (
                        <form action={removeMemberAction}>
                          <input type="hidden" name="userId" value={m.userId} />
                          <ConfirmButton className="btn-danger py-1.5 text-[14px]" message={`Ta bort tillgången för ${m.user.name} till ${company.name}?`}>
                            Ta bort
                          </ConfirmButton>
                        </form>
                      )}
                    </div>
                  ) : (
                    <span className="rounded-full bg-fill px-2.5 py-0.5 text-[12px] font-semibold">{ROLES[m.role as Role]?.label ?? m.role}</span>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          {invitations.length > 0 && (
            <Card title="Väntande inbjudningar">
              <ul className="divide-y divide-line">
                {invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">{i.email}</p>
                      <p className="text-[13px] text-muted">
                        {ROLES[i.role as Role]?.label ?? i.role} · giltig till {dateStr(i.expiresAt)}
                      </p>
                    </div>
                    {owner && (
                      <form action={revokeInvitationAction}>
                        <input type="hidden" name="id" value={i.id} />
                        <ConfirmButton className="btn-secondary py-1.5 text-[14px]" message={`Återkalla inbjudan till ${i.email}?`}>
                          Återkalla
                        </ConfirmButton>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {owner ? (
            <Card title="Bjud in">
              <div className="px-5 pb-5 pt-1">
                <InviteForm companyName={company.name} />
              </div>
            </Card>
          ) : (
            <Card>
              <p className="p-5 text-[14px] text-muted">Bara företagets ägare kan bjuda in och ändra behörigheter.</p>
            </Card>
          )}
          <Card title="Behörigheter">
            <dl className="space-y-3 px-5 pb-5 pt-1 text-[14px]">
              {Object.values(ROLES).map((r) => (
                <div key={r.label}>
                  <dt className="font-medium">{r.label}</dt>
                  <dd className="text-muted">{r.hint}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
