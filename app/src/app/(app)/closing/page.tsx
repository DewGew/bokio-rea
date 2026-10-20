import Link from "next/link";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { contains, fiscalYears, fyLabel, fyRange } from "@/lib/fiscal";
import { Card, PageHeader } from "@/components/ui";
import { Icon } from "@/components/Icon";

export default async function Closing() {
  const { companyId } = await requireCompany();
  const [years, ib] = await Promise.all([
    fiscalYears(companyId),
    db.verification.count({ where: { companyId, series: "IB", reversedById: null } }),
  ]);
  const today = new Date(new Date().toISOString().slice(0, 10));

  return (
    <>
      <PageHeader title="Bokslut" subtitle="Bokför årets skatt och resultat, för över saldona till nästa år och stäng räkenskapsåret." />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Räkenskapsår">
          <ul className="divide-y divide-line">
            {[...years].reverse().map((y) => {
              const status = y.closedAt ? "Stängt" : y.end < today ? "Klart för bokslut" : contains(y, today) ? "Pågår" : "Kommande";
              const tone = y.closedAt ? "bg-success-soft text-success" : y.end < today ? "bg-warn-soft text-warn" : "bg-fill text-muted";
              return (
                <li key={y.id}>
                  <Link href={`/closing/${y.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold">{fyLabel(y)}</p>
                      <p className="text-[13px] text-muted">{fyRange(y)}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${tone}`}>{status}</span>
                    <span className="text-muted">›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Ingående balanser">
          <div className="space-y-3 px-5 pb-5 pt-1 text-[14px]">
            <p className="text-muted">
              Har företaget bokförts i ett annat system tidigare? Ange saldona per {years[0] ? fyRange(years[0]).slice(0, 10) : "första dagen"} för tillgångar,
              eget kapital och skulder. Senare år får sina ingående balanser automatiskt från bokslutet.
            </p>
            <Link href="/closing/opening-balances" className="btn-secondary w-full">
              <Icon name="list" className="h-[18px] w-[18px]" />
              {ib ? "Ändra ingående balanser" : "Ange ingående balanser"}
            </Link>
          </div>
        </Card>
      </div>
    </>
  );
}
