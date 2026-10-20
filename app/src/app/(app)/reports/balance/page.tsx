import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { IB_SERIES, balances, sumRange } from "@/lib/accounting";
import { BALANCE_SECTIONS } from "@/lib/bas";
import { num } from "@/lib/money";
import { Card, PageHeader, readParams, type SP } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { YearForm } from "@/components/YearSelect";
import { fyLabel, pickFiscalYear } from "@/lib/fiscal";

export default async function BalanceReport({ searchParams }: { searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { get } = await readParams(searchParams);
  const { all: years, fy } = await pickFiscalYear(companyId, get("fy"));
  const [before, ib, closing] = await Promise.all([
    balances(companyId, { to: new Date(fy.start.getTime() - 1) }),
    balances(companyId, { from: fy.start, to: fy.end, series: { in: [IB_SERIES] } }),
    balances(companyId, { to: fy.end }),
  ]);
  // Ingående balanser (IB-serien) räknas som ingående saldo, inte som förändring under året.
  const opening = new Map(before);
  for (const [acc, v] of ib) opening.set(acc, (opening.get(acc) ?? 0) + v);
  const accounts = await db.account.findMany({ where: { companyId, number: { lt: 3000 } }, orderBy: { number: "asc" } });

  // Årets resultat (och tidigare ej omförda resultat) läggs till eget kapital tills bokslut görs.
  const resultClosing = -sumRange(closing, 3000, 8999);
  const resultOpening = -sumRange(opening, 3000, 8999);
  const sign = (sectionIdx: number) => (sectionIdx === 0 ? 1 : -1);

  return (
    <>
      <PageHeader title="Balansrapport" subtitle={`Räkenskapsår ${fyLabel(fy)} · per ${fy.end.toISOString().slice(0, 10)}`} actions={<PrintButton />} />
      <Card>
        <YearForm years={years} fy={fy} />
        <div className="overflow-x-auto">
          <table className="table">
            {BALANCE_SECTIONS.map((section, si) => {
              const totalOpen = sign(si) * section.groups.reduce((s, g) => s + sumRange(opening, g.from, g.to), 0) + (si === 1 ? resultOpening : 0);
              const totalClose = sign(si) * section.groups.reduce((s, g) => s + sumRange(closing, g.from, g.to), 0) + (si === 1 ? resultClosing : 0);
              return (
                <tbody key={section.name}>
                  <tr className="bg-surface-2">
                    <th className="text-ink">{section.name}</th>
                    <th className="num">Ingående</th>
                    <th className="num">Förändring</th>
                    <th className="num">Utgående</th>
                  </tr>
                  {section.groups.map((g) => {
                    const accs = accounts.filter((a) => a.number >= g.from && a.number <= g.to && (opening.get(a.number) || closing.get(a.number)));
                    const extra = si === 1 && g.from === 2000 ? [resultOpening, resultClosing] : [0, 0];
                    if (accs.length === 0 && !extra[1] && !extra[0]) return null;
                    const o = sign(si) * sumRange(opening, g.from, g.to) + extra[0];
                    const c = sign(si) * sumRange(closing, g.from, g.to) + extra[1];
                    return [
                      <tr key={g.name}>
                        <td className="font-medium">{g.name}</td>
                        <td className="num font-medium">{num(o)}</td>
                        <td className="num font-medium">{num(c - o)}</td>
                        <td className="num font-medium">{num(c)}</td>
                      </tr>,
                      ...accs.map((a) => {
                        const ao = sign(si) * (opening.get(a.number) ?? 0);
                        const ac = sign(si) * (closing.get(a.number) ?? 0);
                        return (
                          <tr key={a.number} className="text-muted">
                            <td className="pl-8">
                              <a href={`/reports/ledger?account=${a.number}&fy=${fy.id}`} className="hover:text-brand">{a.number} {a.name}</a>
                            </td>
                            <td className="num">{num(ao)}</td>
                            <td className="num">{num(ac - ao)}</td>
                            <td className="num">{num(ac)}</td>
                          </tr>
                        );
                      }),
                      ...(extra[1] || extra[0]
                        ? [
                            <tr key="result" className="text-muted">
                              <td className="pl-8">Beräknat resultat (ej bokslutat)</td>
                              <td className="num">{num(extra[0])}</td>
                              <td className="num">{num(extra[1] - extra[0])}</td>
                              <td className="num">{num(extra[1])}</td>
                            </tr>,
                          ]
                        : []),
                    ];
                  })}
                  <tr className="font-semibold">
                    <td>Summa {section.name.toLowerCase()}</td>
                    <td className="num">{num(totalOpen)}</td>
                    <td className="num">{num(totalClose - totalOpen)}</td>
                    <td className="num">{num(totalClose)}</td>
                  </tr>
                </tbody>
              );
            })}
          </table>
        </div>
      </Card>
    </>
  );
}
