import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { dateTime, requireAdmin } from "@/lib/admin";
import { fyLabel } from "@/lib/fiscal";
import { dateStr } from "@/lib/money";
import { Card, Flash, PageHeader, readParams, Stat, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { companyBookkeeping } from "@/lib/company-delete";
import { adminDeleteCompany, lockCompany, makeOwner, unlockCompany } from "../../actions";

export const dynamic = "force-dynamic";

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} MB`;

/** Företagsdetaljer för administratörer: bara metadata och mängder, aldrig innehållet i bokföringen. */
export default async function AdminCompany({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  await requireAdmin();
  const { notice, error } = await readParams(searchParams);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const company = await db.company.findUnique({
    where: { id },
    select: {
      id: true, name: true, orgNumber: true, companyType: true, vatPeriod: true, createdAt: true, lockedAt: true, lockedReason: true,
      memberships: { select: { userId: true, role: true, user: { select: { name: true, email: true, lockedAt: true } } }, orderBy: { userId: "asc" } },
      fiscalYears: { select: { id: true, start: true, end: true }, orderBy: { start: "asc" } },
    },
  });
  if (!company) notFound();

  const [perYear, sieExports, invoices, issued, customers, uploads] = await Promise.all([
    db.verification.groupBy({ by: ["fiscalYearId"], where: { companyId: id }, _count: { _all: true }, _max: { createdAt: true } }),
    db.sieExport.findMany({ where: { companyId: id }, select: { fiscalYearId: true, exportedAt: true } }),
    db.invoice.count({ where: { companyId: id } }),
    db.invoice.count({ where: { companyId: id, number: { not: null } } }),
    db.customer.count({ where: { companyId: id } }),
    db.upload.aggregate({ where: { companyId: id }, _count: { _all: true }, _sum: { size: true } }),
  ]);
  const bookkeeping = await companyBookkeeping(id);
  const nonOwners = company.memberships.filter((m) => m.role !== "owner");
  const ver = new Map(perYear.map((y) => [y.fiscalYearId, y]));
  const exp = new Map(sieExports.map((e) => [e.fiscalYearId, e.exportedAt]));
  const totalVer = perYear.reduce((n, y) => n + y._count._all, 0);
  const lastActivity = perYear.reduce<Date | null>((m, y) => (y._max.createdAt && (!m || y._max.createdAt > m) ? y._max.createdAt : m), null);

  return (
    <>
      <PageHeader title={company.name} subtitle={`Org.nr ${company.orgNumber} · skapat ${dateStr(company.createdAt)}`} />
      <div className="mb-4 text-[14px]">
        <Link href="/admin" className="text-brand">← Tillbaka till översikten</Link>
      </div>
      <Flash notice={notice} error={error} />
      {company.lockedAt && (
        <p className="mb-4 rounded-2xl bg-warn-soft px-4 py-3 text-[14px] text-warn">
          <strong>Låst {dateTime(company.lockedAt)}.</strong> {company.lockedReason}
        </p>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Verifikationer" value={String(totalVer)} />
        <Stat label="Fakturor (utfärdade)" value={`${invoices} (${issued})`} />
        <Stat label="Kunder" value={String(customers)} />
        <Stat label="Uppladdade filer" value={`${uploads._count._all} · ${mb(uploads._sum.size ?? 0)}`} />
      </div>

      <div className="space-y-6">
        <Card title="Användare">
          <table className="w-full text-[14px]">
            <tbody className="divide-y divide-line">
              {company.memberships.map((m) => (
                <tr key={m.user.email}>
                  <td className="px-5 py-2.5 font-medium">{m.user.name}</td>
                  <td className="px-3 py-2.5">{m.user.email}</td>
                  <td className="px-3 py-2.5">{m.role}</td>
                  <td className="px-5 py-2.5">{m.user.lockedAt ? <span className="text-warn">Användaren är låst</span> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nonOwners.length > 0 ? (
            <form action={makeOwner} className="flex flex-wrap items-center gap-2 px-5 pb-4 pt-2">
              <input type="hidden" name="companyId" value={company.id} />
              <select name="userId" aria-label="Ny ägare" className="input w-auto py-1.5 text-[14px]">
                {nonOwners.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.user.email} ({m.role})</option>
                ))}
              </select>
              <ConfirmButton className="btn-secondary" message="Utse vald användare till ägare? Åtgärden loggas.">Utse till ägare</ConfirmButton>
            </form>
          ) : (
            <p className="px-5 pb-4 pt-2 text-[13px] text-muted">Alla medlemmar är redan ägare.</p>
          )}
        </Card>

        <Card title="Räkenskapsår">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-[0.06em] text-muted">
                <th className="px-5 py-2">År</th>
                <th className="px-3 py-2">Verifikationer</th>
                <th className="px-3 py-2">Senaste bokföring</th>
                <th className="px-5 py-2">SIE-export</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {company.fiscalYears.map((y) => {
                const v = ver.get(y.id);
                const at = exp.get(y.id);
                const current = !v || (!!at && (!v._max.createdAt || at >= v._max.createdAt));
                return (
                  <tr key={y.id}>
                    <td className="px-5 py-2.5 font-medium">{fyLabel(y)}</td>
                    <td className="px-3 py-2.5">{v?._count._all ?? 0}</td>
                    <td className="px-3 py-2.5">{v?._max.createdAt ? dateTime(v._max.createdAt) : "–"}</td>
                    <td className="px-5 py-2.5">{!v ? "–" : at ? `${dateTime(at)}${current ? "" : " (föråldrad)"}` : "Ej exporterad"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {lastActivity && <p className="px-5 pb-4 text-[13px] text-muted">Senast bokfört: {dateTime(lastActivity)}</p>}
        </Card>

        <Card title="Låsning">
          <div className="space-y-3 px-5 pb-5 pt-1 text-[14px]">
            {company.lockedAt ? (
              <form action={unlockCompany} className="space-y-3">
                <input type="hidden" name="companyId" value={company.id} />
                <p className="text-muted">Företaget är låst och alla användare, även ägaren, har bara läsrätt. Inkommande mejl sparas fortfarande som underlag.</p>
                <ConfirmButton className="btn-secondary" message={`Låsa upp ${company.name}?`}>Lås upp</ConfirmButton>
              </form>
            ) : (
              <form action={lockCompany} className="space-y-3">
                <input type="hidden" name="companyId" value={company.id} />
                <p className="text-muted">Gör företaget skrivskyddat för alla användare, till exempel vid en tvist eller misstänkt missbruk. Orsaken visas för användarna.</p>
                <input name="reason" required maxLength={200} placeholder="Orsak" aria-label="Orsak" className="input sm:max-w-md" />
                <div>
                  <ConfirmButton className="btn-secondary" message={`Låsa ${company.name}? Ingen kan ändra något tills det låses upp.`}>Lås företaget</ConfirmButton>
                </div>
              </form>
            )}
          </div>
        </Card>

        <Card title="Radera företag">
          <div className="space-y-3 px-5 pb-5 pt-1 text-[14px]">
            {!company.lockedAt ? (
              <p className="text-muted">Lås företaget först. Radering är bara möjlig för låsta företag.</p>
            ) : bookkeeping.blocked ? (
              <p className="text-muted">
                Företaget har bokföring som inte är exporterad som SIE för {bookkeeping.missingYears.map((y) => fyLabel(y)).join(", ")}. Företagets ägare måste
                exportera den innan företaget kan raderas, eftersom bokföring ska sparas i sju år.
              </p>
            ) : (
              <form action={adminDeleteCompany} className="space-y-3">
                <input type="hidden" name="companyId" value={company.id} />
                <p className="text-muted">
                  Raderar <strong className="text-ink">{company.name}</strong> permanent med allt innehåll. {bookkeeping.hasBookkeeping ? "All bokföring är exporterad som SIE." : "Företaget saknar bokföring."} Det går inte att ångra och åtgärden loggas.
                </p>
                <input name="confirmName" required autoComplete="off" placeholder={company.name} aria-label="Bekräfta företagsnamn" className="input sm:max-w-sm" />
                <div>
                  <ConfirmButton className="btn-danger" message={`Radera ${company.name} permanent?`}>Radera företaget</ConfirmButton>
                </div>
              </form>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
