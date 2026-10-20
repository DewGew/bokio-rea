import Link from "next/link";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { openingBalanceVerification } from "@/lib/closing";
import { fiscalYears, fyLabel } from "@/lib/fiscal";
import { dateStr } from "@/lib/money";
import { Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { OpeningBalanceEditor } from "@/components/OpeningBalanceEditor";
import { saveOpeningBalancesAction } from "../actions";

export default async function OpeningBalances({ searchParams }: { searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { error, notice } = await readParams(searchParams);
  const [years, accounts] = await Promise.all([
    fiscalYears(companyId),
    db.account.findMany({ where: { companyId, active: true, number: { lt: 3000 } }, orderBy: { number: "asc" }, select: { number: true, name: true } }),
  ]);
  const first = years[0];
  const ib = first ? await openingBalanceVerification(companyId, first) : null;
  const initial = (ib?.lines ?? []).map((l) => ({ account: l.accountNumber, amount: l.debit - l.credit }));

  return (
    <>
      <PageHeader
        title="Ingående balanser"
        subtitle={first ? `Saldon per ${dateStr(first.start)}, första dagen i räkenskapsåret ${fyLabel(first)}.` : "Inget räkenskapsår finns."}
        actions={<Link href="/closing" className="btn-secondary">Bokslut</Link>}
      />
      <Flash error={error} notice={notice} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <div className="p-5">
            <OpeningBalanceEditor accounts={accounts} initial={initial} action={saveOpeningBalancesAction} readOnly={!first || !!first.closedAt} />
          </div>
        </Card>
        <Card title="Så fyller du i">
          <ul className="list-disc space-y-2 px-5 pb-5 pl-9 pt-1 text-[14px] text-muted">
            <li>Ta utgående balanser från förra årets balansrapport i ditt tidigare bokföringsprogram (t.ex. Bokio).</li>
            <li>Ange alla saldon som positiva belopp: tillgångar (1xxx) och eget kapital och skulder (2xxx).</li>
            <li>Summorna måste vara lika stora. Föregående års resultat läggs normalt på 2098 (AB) eller 2010 (enskild firma).</li>
            <li>Senare år får sina ingående balanser automatiskt när du gör bokslut.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
