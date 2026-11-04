import Link from "next/link";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { invoiceTotals } from "@/lib/invoice-rules";
import { dateStr, kr } from "@/lib/money";
import { Badge, Card, Empty, Flash, PageHeader, readParams, Segmented, type SP } from "@/components/ui";

const FILTERS = [
  ["all", "Alla"],
  ["draft", "Utkast"],
  ["sent", "Skickad"],
  ["accepted", "Accepterad"],
  ["converted", "Omvandlad"],
  ["rejected", "Avböjd"],
  ["expired", "Utgången"],
] as const;

export default async function Quotes({ searchParams }: { searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { get, error, notice } = await readParams(searchParams);
  const filter = get("status") ?? "all";
  const quotes = await db.quote.findMany({ where: { companyId }, include: { customer: true, lines: true }, orderBy: [{ date: "desc" }, { id: "desc" }] });
  const rows = quotes.map(q => ({ ...q, status: q.status !== "converted" && q.status !== "rejected" && q.status !== "draft" && q.validUntil < new Date(new Date().toISOString().slice(0,10)) ? "expired" : q.status, total: invoiceTotals(q.lines).total }));
  const list = rows.filter(q => filter === "all" || q.status === filter);
  return <>
    <PageHeader title="Offerter" subtitle="Skapa och följ upp offerter" actions={<Link href="/quotes/new" className="btn-primary">Ny offert</Link>} />
    <Flash error={error} notice={notice} />
    <Card>
      <div className="px-4 pb-3 pt-4">
        <Segmented active={filter} items={FILTERS.map(([key, label]) => ({ key, label, href: `/quotes?status=${key}` }))} />
      </div>
      {rows.length === 0 ? <Empty href="/quotes/new" cta="Skapa offert">Du har inga offerter ännu.</Empty> : list.length === 0 ? <Empty href="/quotes/new" cta="Skapa offert">Inga offerter med den här statusen.</Empty> : <div className="overflow-x-auto"><table className="table"><thead><tr><th>Nr</th><th>Kund</th><th>Offertdatum</th><th>Giltig till</th><th>Status</th><th className="num">Summa inkl. moms</th></tr></thead><tbody>
        {list.map(q => <tr key={q.id}><td><Link href={`/quotes/${q.id}`} className="font-medium text-brand">{q.number == null ? "Utkast" : q.number}</Link></td><td><Link href={`/quotes/${q.id}`} className="hover:underline">{q.customer.name}</Link></td><td>{dateStr(q.date)}</td><td>{dateStr(q.validUntil)}</td><td><Badge status={q.status} /></td><td className="num">{kr(q.total)}</td></tr>)}
      </tbody></table></div>}
    </Card>
    <p className="mt-3 text-xs text-muted">Offerter påverkar inte bokföringen eller momsredovisningen. En faktura skapas först när en accepterad offert omvandlas.</p>
  </>;
}
