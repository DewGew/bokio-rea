import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { dateStr, kr, parseDate } from "@/lib/money";
import { periodLabel, vatPeriods, vatReport } from "@/lib/vat";
import { Badge, Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { lockPeriod } from "../actions";

export default async function VatPeriod({ params, searchParams }: { params: Promise<{ start: string }>; searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { start: s } = await params;
  const { error, notice } = await readParams(searchParams);
  const date = parseDate(s);
  if (!date) notFound();
  const period = (await vatPeriods(companyId)).find((p) => p.start.getTime() === date.getTime());
  if (!period) notFound();
  const { start, end } = period;
  const report = await vatReport(companyId, start, end);
  const stored = await db.vatPeriod.findUnique({ where: { companyId_start_end: { companyId, start, end } } });
  const settlement = stored?.verificationId ? await db.verification.findUnique({ where: { id: stored.verificationId } }) : null;
  const unbooked = await db.upload.count({ where: { companyId, verificationId: null, expense: null } });
  const isOver = !period.current && end < new Date(new Date().toISOString().slice(0, 10));
  const accounts = await db.account.findMany({ where: { companyId, number: { in: [...report.balances.keys()].filter((n) => n >= 2600 && n < 2700) } } });

  return (
    <>
      <PageHeader
        title={`Moms ${periodLabel(period)}`}
        subtitle={`${dateStr(start)} – ${dateStr(end)} · deklareras och betalas senast ${dateStr(period.deadline)}`}
        actions={<Link href="/vat" className="btn-secondary">Alla perioder</Link>}
      />
      <Flash error={error} notice={notice} />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title="Momsdeklaration (rutor enligt Skatteverket)" action={stored?.lockedAt ? <Badge status="locked" /> : undefined}>
          <table className="table">
            <thead>
              <tr>
                <th className="w-14">Ruta</th>
                <th>Beskrivning</th>
                <th className="num">Belopp</th>
              </tr>
            </thead>
            <tbody>
              {report.boxes.map((b) => (
                <tr key={b.box} className={b.box === "49" ? "font-semibold" : b.amount === 0 ? "text-muted" : ""}>
                  <td>{b.box}</td>
                  <td>{b.label}</td>
                  <td className="num">{kr(b.box === "49" ? Math.abs(b.amount) : b.amount, { decimals: b.box !== "49" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div className="space-y-4">
          <Card title="Momskonton i perioden">
            <table className="table">
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.number}>
                    <td>
                      <Link href={`/reports/ledger?account=${a.number}&year=${start.getUTCFullYear()}`} className="text-brand">{a.number}</Link>{" "}
                      <span className="text-xs text-muted">{a.name}</span>
                    </td>
                    <td className="num">{kr(report.balances.get(a.number) ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Stäm av och lås">
            <div className="space-y-3 p-4 text-sm">
              {stored?.lockedAt ? (
                <p>
                  Låst {dateStr(stored.lockedAt)}.{" "}
                  {settlement && (
                    <Link href={`/verifications/${settlement.id}`} className="text-brand">Visa momsverifikat {settlement.series}{settlement.number}</Link>
                  )}
                </p>
              ) : (
                <>
                  {unbooked > 0 && (
                    <p className="rounded-xl bg-warn-soft px-3 py-2 text-warn">
                      Du har <Link href="/uploads" className="underline">{unbooked} obokförda underlag</Link>. Bokför allt i perioden först.
                    </p>
                  )}
                  <p className="text-muted">
                    Vid låsning nollställs momskontona mot 2650 (Redovisningskonto för moms) och inga fler verifikat kan bokföras i perioden.
                    Lämna sedan in deklarationen hos Skatteverket med beloppen ovan.
                  </p>
                  <form action={lockPeriod}>
                    <input type="hidden" name="start" value={dateStr(start)} />
                    {isOver ? (
                      <ConfirmButton message="Lås perioden? Det går inte att bokföra i den efteråt.">Stäm av och lås perioden</ConfirmButton>
                    ) : (
                      <p className="text-muted">Perioden pågår fortfarande.</p>
                    )}
                  </form>
                </>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
