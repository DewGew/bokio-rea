import Link from "next/link";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { balances } from "@/lib/accounting";
import { dateStr, num } from "@/lib/money";
import { Card, Empty, PageHeader, readParams, type SP } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { YearForm } from "@/components/YearSelect";
import { fyLabel, pickFiscalYear } from "@/lib/fiscal";

export default async function Ledger({ searchParams }: { searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { get } = await readParams(searchParams);
  const { all: years, fy } = await pickFiscalYear(companyId, get("fy"));
  const only = Number(get("account")) || undefined;
  const from = fy.start;
  const to = fy.end;

  const [opening, lines, accounts] = await Promise.all([
    balances(companyId, { to: new Date(from.getTime() - 1) }),
    db.verificationLine.findMany({
      where: { companyId, accountNumber: only, verification: { date: { gte: from, lte: to } } },
      include: { verification: true },
      orderBy: [{ verification: { date: "asc" } }, { verification: { number: "asc" } }],
    }),
    db.account.findMany({ where: { companyId }, orderBy: { number: "asc" } }),
  ]);

  const used = accounts.filter((a) => (only ? a.number === only : lines.some((l) => l.accountNumber === a.number)));

  return (
    <>
      <PageHeader title="Huvudbok" subtitle={only ? `Konto ${only}` : `Alla konton med transaktioner, räkenskapsår ${fyLabel(fy)}`} actions={<PrintButton />} />
      <Card>
        <YearForm years={years} fy={fy}>
          <div>
            <label className="label" htmlFor="account">Konto</label>
            <select id="account" name="account" defaultValue={only ?? ""} className="input w-72">
              <option value="">Alla konton</option>
              {accounts.map((a) => <option key={a.number} value={a.number}>{a.number} {a.name}</option>)}
            </select>
          </div>
        </YearForm>
        {used.length === 0 && <Empty>Inga transaktioner.</Empty>}
        {used.map((a) => {
          // Resultatkonton börjar om på noll varje år.
          let bal = a.number < 3000 ? (opening.get(a.number) ?? 0) : 0;
          const rows = lines.filter((l) => l.accountNumber === a.number);
          return (
            <div key={a.number} className="overflow-x-auto border-b border-line last:border-0">
              <h3 className="px-4 pb-1 pt-4 text-sm font-semibold">{a.number} {a.name}</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-16">Ver</th>
                    <th className="w-28">Datum</th>
                    <th>Text</th>
                    <th className="num w-32">Debet</th>
                    <th className="num w-32">Kredit</th>
                    <th className="num w-32">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="text-muted">
                    <td colSpan={5}>Ingående saldo</td>
                    <td className="num">{num(bal)}</td>
                  </tr>
                  {rows.map((l) => {
                    bal += l.debit - l.credit;
                    return (
                      <tr key={l.id}>
                        <td><Link href={`/verifications/${l.verificationId}`} className="text-brand">{l.verification.series}{l.verification.number}</Link></td>
                        <td className="whitespace-nowrap">{dateStr(l.verification.date)}</td>
                        <td>{l.text || l.verification.description}</td>
                        <td className="num">{l.debit ? num(l.debit) : ""}</td>
                        <td className="num">{l.credit ? num(l.credit) : ""}</td>
                        <td className="num">{num(bal)}</td>
                      </tr>
                    );
                  })}
                  <tr className="font-semibold">
                    <td colSpan={5}>Utgående saldo</td>
                    <td className="num">{num(bal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </Card>
    </>
  );
}
