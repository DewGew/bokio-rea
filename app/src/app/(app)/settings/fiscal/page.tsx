import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { contains, fiscalYears, fyLabel, monthsBetween } from "@/lib/fiscal";
import { dateStr } from "@/lib/money";
import { periodLabel, vatPeriods } from "@/lib/vat";
import { Card, PageHeader } from "@/components/ui";
import { FiscalYearsTable, TaxSettingsForm } from "@/components/FiscalSettings";

export default async function FiscalSettings() {
  const { companyId, company } = await requireCompany();
  const [years, counts, unpaid, periods] = await Promise.all([
    fiscalYears(companyId),
    db.verification.groupBy({ by: ["fiscalYearId"], where: { companyId }, _count: true }),
    db.invoice.count({ where: { companyId, status: "sent" } }),
    vatPeriods(companyId),
  ]);
  const today = new Date(new Date().toISOString().slice(0, 10));
  const next = [...periods].reverse().find((p) => !p.lockedAt && !p.current) ?? periods.find((p) => p.current);

  return (
    <>
      <PageHeader title="Räkenskapsår och moms" subtitle="Inställningar som styr hur bokföringen, momsen och verifikatnumreringen fungerar." />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card title="Företag, bokföringsmetod och moms">
          <div className="px-5 pb-5 pt-2">
            <TaxSettingsForm
              unpaidInvoices={unpaid}
              initial={{
                companyType: company.companyType,
                accountingMethod: company.accountingMethod,
                vatPeriod: company.vatPeriod,
                euTrade: company.euTrade,
                fiscalStartMonth: company.fiscalStartMonth,
              }}
            />
          </div>
        </Card>

        <div className="space-y-6">
          {company.vatPeriod !== "none" && next && (
            <Card title="Nästa momsdeklaration">
              <div className="flex items-center gap-4 px-5 pb-5 pt-1">
                <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-brand-soft text-center text-brand">
                  <span>
                    <span className="block text-[22px] font-semibold leading-none">{next.deadline.getUTCDate()}</span>
                    <span className="text-[11px] font-semibold uppercase">{next.deadline.toLocaleDateString("sv-SE", { month: "short", timeZone: "UTC" })}</span>
                  </span>
                </div>
                <div className="text-[14px]">
                  <p className="font-semibold">{periodLabel(next)}</p>
                  <p className="text-muted">Deklarera och betala senast {dateStr(next.deadline)}</p>
                </div>
              </div>
            </Card>
          )}

          <Card title="Räkenskapsår">
            <div className="px-5 pb-5 pt-2">
              <p className="mb-4 text-[13px] text-muted">
                Verifikaten numreras från V1 i varje räkenskapsår. Nästa år skapas automatiskt när du bokför efter årets slut. Under Bokslut bokförs årets skatt och resultat och året stängs.
              </p>
              <FiscalYearsTable
                years={years.map((y) => ({
                  id: y.id,
                  label: fyLabel(y),
                  start: dateStr(y.start),
                  end: dateStr(y.end),
                  months: monthsBetween(y.start, y.end),
                  closed: !!y.closedAt,
                  ended: y.end < today,
                  current: contains(y, today),
                  verifications: counts.find((c) => c.fiscalYearId === y.id)?._count ?? 0,
                }))}
              />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
