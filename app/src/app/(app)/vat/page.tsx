import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { dateStr, kr } from "@/lib/money";
import { VAT_FREQUENCIES, periodLabel, vatPeriods, vatReport } from "@/lib/vat";
import { Badge, Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAJ", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEC"];

export default async function Vat({ searchParams }: { searchParams: SP }) {
  const { companyId, company } = await requireCompany();
  const { error, notice } = await readParams(searchParams);
  const periods = await vatPeriods(companyId);
  const now = new Date();
  const withAmounts = await Promise.all(periods.map(async (p) => ({ ...p, toPay: (await vatReport(companyId, p.start, p.end)).toPay })));

  return (
    <>
      <PageHeader
        title="Momsredovisning"
        subtitle={`Redovisningsperiod: ${VAT_FREQUENCIES[company.vatPeriod as keyof typeof VAT_FREQUENCIES] ?? company.vatPeriod}. Perioder deklareras i tur och ordning och låses när de är avstämda.`}
        actions={<Link href="/settings/fiscal" className="btn-secondary">Ändra inställningar</Link>}
      />
      <Flash error={error} notice={notice} />
      {company.vatPeriod === "none" && (
        <Card className="mb-6 p-5 text-[15px]">
          Företaget är inställt som <strong>ej momsregistrerat</strong>. Ingen moms dras eller redovisas.{" "}
          <Link href="/settings/fiscal" className="text-brand">Ändra under Räkenskapsår och moms</Link>.
        </Card>
      )}
      {withAmounts.length > 0 && (
      <Card>
        <ul className="divide-y divide-line">
          {withAmounts.map((p) => {
            const status = p.lockedAt ? "locked" : p.current ? "open" : p.deadline < now ? "late" : "pending";
            const label = periodLabel(p);
            return (
              <li key={p.start.toISOString()}>
                <Link href={`/vat/${dateStr(p.start)}`} className="flex items-center gap-4 px-4 py-3 hover:bg-surface-2">
                  <div className="w-14 shrink-0 rounded-xl border border-line py-1 text-center">
                    <p className="text-[10px] text-muted">{p.deadline.getUTCFullYear()}</p>
                    <p className="text-lg font-semibold leading-tight">{p.deadline.getUTCDate()}</p>
                    <p className="text-[10px] font-medium text-muted">{MONTHS[p.deadline.getUTCMonth()]}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{label}</p>
                    <p className="text-sm text-muted">
                      {p.current ? "Perioden pågår" : p.lockedAt ? `Låst ${dateStr(p.lockedAt)}` : `Deklarera senast ${dateStr(p.deadline)}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm tabular-nums">{kr(Math.abs(p.toPay), { decimals: false })}</p>
                    <p className="text-xs text-muted">{p.toPay >= 0 ? "att betala" : "att få tillbaka"}</p>
                  </div>
                  <span className="hidden sm:block">
                    <Badge status={status === "pending" ? "todo" : status} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
      )}
    </>
  );
}
