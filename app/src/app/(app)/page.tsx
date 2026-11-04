import Link from "next/link";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { balances, invoiceTotals, sumRange } from "@/lib/accounting";
import { kr } from "@/lib/money";
import { estimateAnnualTax } from "@/lib/tax-calculation";
import { periodLabel, vatPeriods, vatReport } from "@/lib/vat";
import { currentFiscalYear, fyLabel } from "@/lib/fiscal";
import { Card, Flash, PageHeader, readParams, Stat, type SP } from "@/components/ui";
import { BarChart } from "@/components/BarChart";

export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  const { notice } = await readParams(searchParams);
  const { companyId, company } = await requireCompany();
  const now = new Date();
  // Räkenskapsåret och momsperioden som pågår idag.
  const [fy, periods] = await Promise.all([currentFiscalYear(companyId), vatPeriods(companyId)]);
  const yearStart = fy.start;
  const vatPeriod = periods.find((p) => p.current) ?? null;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  // Alla frågor körs parallellt; varje databasrundresa kostar tid, särskilt i serverless.
  const [yearBal, allBal, openInvoices, unpaidSupplierInvoices, pendingSupplierInvoices, toBook, pendingExpenses, drafts, quoteDrafts, sentQuotes, vat, lines, bankToBook, taxYearBal, taxPartners] = await Promise.all([
    balances(companyId, { from: yearStart, to: now }),
    balances(companyId),
    db.invoice.findMany({ where: { companyId, status: "sent" }, include: { lines: true } }),
    db.supplierInvoice.aggregate({ where: { companyId, status: { in: ["pending", "booked"] } }, _sum: { amount: true } }),
    db.supplierInvoice.count({ where: { companyId, status: "pending" } }),
    db.upload.count({ where: { companyId, verificationId: null, expense: null } }),
    db.expense.count({ where: { companyId, status: "pending" } }),
    db.invoice.count({ where: { companyId, status: "draft" } }),
    db.quote.count({ where: { companyId, status: "draft" } }),
    db.quote.count({ where: { companyId, status: "sent" } }),
    vatPeriod ? vatReport(companyId, vatPeriod.start, vatPeriod.end) : null,
    // Inkomster och kostnader per månad, senaste 12 månaderna.
    db.verificationLine.findMany({
      where: { companyId, accountNumber: { gte: 3000, lte: 8989 }, verification: { date: { gte: from } } },
      select: { debit: true, credit: true, accountNumber: true, verification: { select: { date: true } }, account: { select: { name: true } } },
    }),
    db.bankTransaction.count({ where: { companyId, status: "new" } }),
    (company.companyType === "ef" || company.companyType === "hb") ? balances(companyId, { from: fy.start, to: fy.end }) : Promise.resolve(new Map<number, number>()),
    (company.companyType === "ef" || company.companyType === "hb") ? db.taxPartner.findMany({ where: { companyId }, orderBy: { id: "asc" } }) : Promise.resolve([]),
  ]);
  const result = -sumRange(yearBal, 3000, 8989);
  const bank = sumRange(allBal, 1900, 1999);
  const unpaid = openInvoices.reduce((s, i) => s + invoiceTotals(i.lines).total, 0);
  const overdue = openInvoices.filter((i) => i.dueDate < now).reduce((s, i) => s + invoiceTotals(i.lines).total, 0);
  const unpaidSupplierTotal = unpaidSupplierInvoices._sum.amount ?? 0;
  const taxYear = now.getFullYear();
  const taxProfit = -sumRange(taxYearBal, 3000, 8989) / 100;
  const estimatedTax = taxPartners.reduce((sum, partner) => {
    const estimate = estimateAnnualTax({
      taxYear,
      birthYear: partner.birthYear,
      municipalityTaxRate: partner.municipalityTaxRate,
      otherEmploymentIncome: partner.otherIncome,
      businessProfit: taxProfit * partner.sharePercent / 100,
      activityType: partner.activityType === "passive" ? "passive" : "active",
    });
    return sum + (estimate.supported ? estimate.totalToReserve : 0);
  }, 0);
  const hasTaxEstimate = taxPartners.length > 0 && taxYear === 2026;

  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1));
    return { key: d.toISOString().slice(0, 7), label: d.toLocaleDateString("sv-SE", { month: "short", timeZone: "UTC" }), income: 0, cost: 0 };
  });
  const costs = new Map<string, number>();
  for (const l of lines) {
    const m = months.find((x) => x.key === l.verification.date.toISOString().slice(0, 7));
    const amount = l.debit - l.credit;
    if (l.accountNumber < 4000) {
      if (m) m.income -= amount;
    } else {
      if (m) m.cost += amount;
      costs.set(l.account.name, (costs.get(l.account.name) ?? 0) + amount);
    }
  }
  const topCosts = [...costs.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const income12 = months.reduce((s, m) => s + m.income, 0);
  const cost12 = months.reduce((s, m) => s + m.cost, 0);

  const todos = [
    bankToBook > 0 && { href: "/bank", text: `${bankToBook} banktransaktioner att bokföra` },
    toBook > 0 && { href: "/uploads", text: `${toBook} underlag att bokföra` },
    pendingSupplierInvoices > 0 && { href: "/supplier-invoices", text: `${pendingSupplierInvoices} leverantörsfakturor att bokföra` },
    pendingExpenses > 0 && { href: "/expenses", text: `${pendingExpenses} utlägg att bokföra` },
    drafts > 0 && { href: "/invoices?status=draft", text: `${drafts} fakturautkast` },
    quoteDrafts > 0 && { href: "/quotes", text: `${quoteDrafts} offertutkast` },
    sentQuotes > 0 && { href: "/quotes", text: `${sentQuotes} skickade offerter att följa upp` },
    overdue > 0 && { href: "/invoices?status=overdue", text: `Förfallna fakturor på ${kr(overdue)}` },
  ].filter(Boolean) as { href: string; text: string }[];

  return (
    <>
      <PageHeader
        title="Översikt"
        subtitle={`Räkenskapsår ${fyLabel(fy)}`}
        actions={
          <>
            <Link href="/uploads" className="btn-secondary">Ladda upp underlag</Link>
            <Link href="/invoices/new" className="btn-primary">Ny faktura</Link>
          </>
        }
      />

      <Flash notice={notice} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Årets resultat" value={kr(result)} tone={result < 0 ? "danger" : "success"} />
        <Stat label="Saldo bank och kassa" value={kr(bank)} hint="Enligt bokföringen (19xx)" />
        <Stat label="Obetalda kundfakturor" value={kr(unpaid)} hint={overdue ? `varav förfallet ${kr(overdue)}` : "Inget förfallet"} tone={overdue ? "warn" : undefined} />
        <Stat label="Obetalda leverantörsfakturor" value={kr(unpaidSupplierTotal)} />
        <Stat
          label={vatPeriod ? `Preliminär moms, ${periodLabel(vatPeriod)}` : "Moms"}
          value={vat ? kr(Math.abs(vat.toPay)) : "–"}
          hint={vat ? (vat.toPay >= 0 ? "Att betala" : "Att få tillbaka") : "Ej momsregistrerat"}
        />
        {(company.companyType === "ef" || company.companyType === "hb") && (
          <Stat label="Årets skatt" value={hasTaxEstimate ? kr(estimatedTax * 100) : "–"} hint={hasTaxEstimate ? "Att betala" : "Fyll i uppgifter under Årets skatt"} />
        )}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Inkomster och kostnader, senaste 12 månaderna" className="xl:col-span-2">
          <div className="p-4">
            <div className="mb-3 flex flex-wrap gap-4 text-sm">
              <span>Inkomster <strong className="tabular-nums">{kr(income12, { decimals: false })}</strong></span>
              <span>Kostnader <strong className="tabular-nums">{kr(cost12, { decimals: false })}</strong></span>
            </div>
            <BarChart data={months.map((m) => ({ label: m.label, a: m.income / 100, b: m.cost / 100 }))} aLabel="Inkomster" bLabel="Kostnader" />
          </div>
        </Card>

        <Card title="Att göra">
          {todos.length === 0 ? (
            <p className="p-4 text-sm text-muted">Allt är bokfört. Snyggt!</p>
          ) : (
            <ul className="divide-y divide-line">
              {todos.map((t) => (
                <li key={t.href}>
                  <Link href={t.href} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-surface-2">
                    {t.text}
                    <span className="text-muted">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Topp 5 kostnader, senaste 12 månaderna" className="xl:col-span-2" action={<Link href="/reports/result" className="text-sm text-brand">Resultatrapport</Link>}>
          {topCosts.length === 0 ? (
            <p className="p-4 text-sm text-muted">Inga kostnader bokförda ännu.</p>
          ) : (
            <ul className="space-y-3 p-4">
              {topCosts.map(([name, v]) => (
                <li key={name} className="text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="truncate">{name}</span>
                    <span className="tabular-nums">{kr(v, { decimals: false })}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-fill">
                    <div className="h-1.5 rounded-full bg-brand" style={{ width: `${(v / topCosts[0][1]) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Snabbval">
          <div className="grid gap-2 p-4">
            <Link href="/verifications/new" className="btn-secondary justify-start">Nytt verifikat</Link>
            <Link href="/expenses" className="btn-secondary justify-start">Registrera utlägg</Link>
            <Link href="/vat" className="btn-secondary justify-start">Momsredovisning</Link>
            <Link href="/reports/balance" className="btn-secondary justify-start">Balansrapport</Link>
          </div>
        </Card>

      </div>
    </>
  );
}
