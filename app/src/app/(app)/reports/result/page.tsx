import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { balances, sumRange } from "@/lib/accounting";
import { RESULT_SECTIONS } from "@/lib/bas";
import { num } from "@/lib/money";
import { Card, PageHeader, readParams, type SP } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { YearForm } from "@/components/YearSelect";
import { fyLabel, pickFiscalYear } from "@/lib/fiscal";

export default async function ResultReport({ searchParams }: { searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { get } = await readParams(searchParams);
  const { all: years, fy } = await pickFiscalYear(companyId, get("fy"));
  const decimals = get("dec") === "1";
  // Valt räkenskapsår jämfört med föregående (om det finns).
  const prev = years[years.findIndex((y) => y.id === fy.id) - 1];
  const fys = prev ? [fy, prev] : [fy];
  const cols = fys.map((y) => fyLabel(y));
  const data = await Promise.all(fys.map((y) => balances(companyId, { from: y.start, to: y.end })));
  const accounts = await db.account.findMany({ where: { companyId, number: { gte: 3000, lte: 8999 } } });
  // Intäkter visas positiva, kostnader negativa (kredit - debet).
  const val = (i: number, from: number, to: number) => -sumRange(data[i], from, to);
  const f = (ore: number) => num(ore, decimals);

  let running = cols.map(() => 0);

  return (
    <>
      <PageHeader title="Resultatrapport" actions={<PrintButton />} />
      <Card>
        <YearForm years={years} fy={fy}>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" name="dec" value="1" defaultChecked={decimals} /> Visa decimaler
          </label>
        </YearForm>
        <div className="overflow-x-auto">
          <table className="table">
            {RESULT_SECTIONS.map((section) => {
              const totals = cols.map((_, i) => section.groups.reduce((s, g) => s + val(i, g.from, g.to), 0));
              running = running.map((r, i) => r + totals[i]);
              return (
                <tbody key={section.name}>
                  <tr className="bg-surface-2">
                    <th className="text-ink">{section.name}</th>
                    {cols.map((y) => <th key={y} className="num">{y}</th>)}
                  </tr>
                  {section.groups.map((g) => {
                    const accs = accounts.filter((a) => a.number >= g.from && a.number <= g.to && cols.some((_, i) => data[i].get(a.number)));
                    if (accs.length === 0) return null;
                    return [
                      <tr key={g.name}>
                        <td className="font-medium">{g.name}</td>
                        {cols.map((y, i) => <td key={y} className="num font-medium">{f(val(i, g.from, g.to))}</td>)}
                      </tr>,
                      ...accs.map((a) => (
                        <tr key={a.number} className="text-muted">
                          <td className="pl-8">
                            <a href={`/reports/ledger?account=${a.number}&fy=${fy.id}`} className="hover:text-brand">{a.number} {a.name}</a>
                          </td>
                          {cols.map((y, i) => <td key={y} className="num">{f(-(data[i].get(a.number) ?? 0))}</td>)}
                        </tr>
                      )),
                    ];
                  })}
                  <tr className="font-semibold">
                    <td>Summa {section.name.toLowerCase()}</td>
                    {totals.map((t, i) => <td key={i} className="num">{f(t)}</td>)}
                  </tr>
                  {section.name !== "Rörelsens intäkter" && (
                    <tr className="font-semibold text-brand">
                      <td>Resultat efter {section.name.toLowerCase()}</td>
                      {running.map((t, i) => <td key={i} className="num">{f(t)}</td>)}
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      </Card>
    </>
  );
}
