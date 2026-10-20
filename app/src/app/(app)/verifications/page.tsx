import Link from "next/link";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { dateStr, kr } from "@/lib/money";
import { Badge, Card, Empty, Flash, PageHeader, readParams, type SP } from "@/components/ui";

export default async function Verifications({ searchParams }: { searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { get, error, notice } = await readParams(searchParams);
  const years = (await db.verification.findMany({ where: { companyId }, distinct: ["year"], select: { year: true }, orderBy: { year: "desc" } })).map((v) => v.year);
  const year = Number(get("year")) || years[0] || new Date().getUTCFullYear();
  const q = get("q") ?? "";

  const list = await db.verification.findMany({
    where: {
      companyId,
      year,
      OR: q
        ? [
            { description: { contains: q } },
            { lines: { some: { accountNumber: Number(q) || -1 } } },
            { number: Number(q.replace(/^V/i, "")) || -1 },
          ]
        : undefined,
    },
    include: { lines: true, uploads: { select: { id: true } }, reverses: { select: { id: true } } },
    orderBy: [{ date: "desc" }, { number: "desc" }],
  });

  return (
    <>
      <PageHeader
        title="Bokfört"
        subtitle="Alla verifikat i bokföringen"
        actions={
          <>
            <Link href="/uploads" className="btn-secondary">Ladda upp underlag</Link>
            <Link href="/verifications/new" className="btn-primary">Nytt verifikat</Link>
          </>
        }
      />
      <Flash error={error} notice={notice} />
      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div>
            <label className="label" htmlFor="year">Räkenskapsår</label>
            <select id="year" name="year" defaultValue={year} className="input w-32">
              {(years.length ? years : [year]).map((y) => <option key={y}>{y}</option>)}
            </select>
          </div>
          <div className="min-w-48 flex-1">
            <label className="label" htmlFor="q">Sök</label>
            <input id="q" name="q" defaultValue={q} placeholder="Titel, konto eller nummer" className="input" />
          </div>
          <button className="btn-secondary">Filtrera</button>
        </form>
        {list.length === 0 ? (
          <Empty href="/verifications/new" cta="Skapa verifikat">Inga verifikat hittades.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Nr</th>
                  <th>Datum</th>
                  <th>Titel</th>
                  <th className="hidden sm:table-cell">Underlag</th>
                  <th className="num">Debet/Kredit</th>
                </tr>
              </thead>
              <tbody>
                {list.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <Link href={`/verifications/${v.id}`} className="font-medium text-brand">{v.series}{v.number}</Link>
                    </td>
                    <td className="whitespace-nowrap">{dateStr(v.date)}</td>
                    <td>
                      <Link href={`/verifications/${v.id}`} className="hover:underline">{v.description}</Link>{" "}
                      {v.reversedById && <Badge status="reversed" />}
                    </td>
                    <td className="hidden text-muted sm:table-cell">{v.uploads.length ? "📎" : ""}</td>
                    <td className="num">{kr(v.lines.reduce((s, l) => s + l.debit, 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-4 py-3 text-xs text-muted">Visar {list.length} verifikat</p>
      </Card>
    </>
  );
}
