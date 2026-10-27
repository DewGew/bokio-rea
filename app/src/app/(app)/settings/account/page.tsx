import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { accountPlan } from "@/lib/account-delete";
import { fyLabel } from "@/lib/fiscal";
import { Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { deleteAccountAction } from "./actions";

export default async function AccountPage({ searchParams }: { searchParams: SP }) {
  const { user } = await requireCompany();
  const { notice, error } = await readParams(searchParams);
  const plans = await accountPlan(user.id);
  const blocked = plans.some((p) => p.action === "blocked");
  const deleting = plans.filter((p) => p.action === "delete");

  return (
    <>
      <PageHeader title="Mitt konto" subtitle={`${user.name} · ${user.email}`} />
      <Flash notice={notice} error={error} />
      <Card title="Avsluta konto" className="max-w-3xl">
        <div className="space-y-4 px-5 pb-5 pt-1 text-[14px]">
          <p className="text-muted">
            Avslutar du kontot raderas din inloggning, dina sessioner och dina kopplingar (till exempel Claude). Du kan inte logga in igen.
            Det går inte att ångra.
          </p>

          <div>
            <h3 className="mb-1.5 font-medium">Vad händer med dina företag</h3>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {plans.map((p) => (
                <li key={p.companyId} className="space-y-1 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{p.name}</span>
                    <span className={p.action === "blocked" ? "text-danger" : p.action === "delete" ? "text-warn" : "text-muted"}>
                      {p.action === "leave" && "Du lämnar företaget"}
                      {p.action === "delete" && "Företaget tas bort"}
                      {p.action === "blocked" && "Måste ordnas först"}
                    </span>
                  </div>
                  {p.action === "delete" && (
                    <p className="text-muted">
                      Du är ensam medlem, så företaget tas bort med allt innehåll{p.hasBookkeeping ? " (bokföringen är exporterad som SIE)" : ""}.
                    </p>
                  )}
                  {p.action === "blocked" && (
                    <p className="text-muted">
                      {p.reason}
                      {p.missingYears && p.missingYears.length > 0 && (
                        <>
                          {" "}Saknar export: <strong className="text-ink">{p.missingYears.map((y) => fyLabel(y)).join(", ")}</strong>.{" "}
                          <Link href="/settings/import-export" className="text-brand">Import och export</Link>
                        </>
                      )}
                      {!p.missingYears && (
                        <>
                          {" "}<Link href="/settings/users" className="text-brand">Användare och behörighet</Link>
                        </>
                      )}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {deleting.some((p) => p.hasBookkeeping) && (
            <div className="rounded-lg bg-warn-soft px-3 py-2 text-warn">
              Varning: SIE-filerna innehåller bara bokföringen. Underlag och fakturakopior följer inte med, och även de ska sparas i sju år.
              Ladda ner dem under <Link href="/settings/import-export" className="underline">Import och export</Link> (Exportera underlag) innan du avslutar kontot.
            </div>
          )}

          {blocked ? (
            <p className="text-muted">Åtgärda det som står ovan, så kan du avsluta kontot här.</p>
          ) : (
            <form action={deleteAccountAction} className="space-y-3">
              <div>
                <label className="label" htmlFor="pw">Bekräfta med ditt lösenord</label>
                <input id="pw" name="password" type="password" required autoComplete="current-password" className="input sm:max-w-sm" />
              </div>
              <ConfirmButton className="btn-danger" message="Avsluta kontot permanent?">Avsluta mitt konto</ConfirmButton>
            </form>
          )}
        </div>
      </Card>
    </>
  );
}
