import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { AccountingError, balances, type LineInput } from "@/lib/accounting";
import { carryForwardLines, closingPreview, CORPORATE_TAX_RATE } from "@/lib/closing";
import { fyLabel, fyRange } from "@/lib/fiscal";
import { dateStr, kr, num } from "@/lib/money";
import { Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Icon } from "@/components/Icon";
import { closeYearAction, reopenYearAction } from "../actions";

function Entry({ title, date, lines, names }: { title: string; date: Date; lines: LineInput[]; names: Map<number, string> }) {
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-line">
      <p className="flex justify-between gap-3 bg-surface-2 px-4 py-2 text-[13px]">
        <span className="font-semibold">{title}</span>
        <span className="text-muted">{dateStr(date)}</span>
      </p>
      <table className="table">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="w-16">{l.account}</td>
              <td className="text-muted">{names.get(l.account)}</td>
              <td className="num">{l.debit ? num(l.debit) : ""}</td>
              <td className="num">{l.credit ? num(l.credit) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ClosingYear({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { id } = await params;
  const { get, error, notice } = await readParams(searchParams);
  const taxParam = get("tax");
  const taxOverride = taxParam ? Math.round(Number(taxParam.replace(/\s/g, "").replace(",", ".")) * 100) : undefined;

  let p;
  try {
    p = await closingPreview(companyId, Number(id) || -1, Number.isFinite(taxOverride) ? taxOverride : undefined);
  } catch (e) {
    if (e instanceof AccountingError) notFound();
    throw e;
  }
  const accounts = await db.account.findMany({ where: { companyId }, select: { number: true, name: true } });
  const names = new Map(accounts.map((a) => [a.number, a.name]));

  // Förhandsvisning av utgående saldon efter bokslutet = ingående balanser nästa år.
  const projected = await balances(companyId, { to: p.fy.end });
  if (!p.fy.closedAt) {
    for (const e of p.entries) for (const l of e.lines) projected.set(l.account, (projected.get(l.account) ?? 0) + (l.debit ?? 0) - (l.credit ?? 0));
  }
  const carry = p.fy.closedAt ? [] : carryForwardLines(p.company, projected);
  const nextIb = new Map(projected);
  for (const l of carry) nextIb.set(l.account, (nextIb.get(l.account) ?? 0) + (l.debit ?? 0) - (l.credit ?? 0));
  const ibRows = [...nextIb.entries()].filter(([a, v]) => a < 3000 && v !== 0).sort((a, b) => a[0] - b[0]);
  const assets = ibRows.filter(([a]) => a < 2000).reduce((s, [, v]) => s + v, 0);

  const closingVerifications = p.fy.closingVerificationIds.length
    ? await db.verification.findMany({ where: { id: { in: p.fy.closingVerificationIds } }, orderBy: { id: "asc" } })
    : [];

  return (
    <>
      <PageHeader
        title={`Bokslut ${fyLabel(p.fy)}`}
        subtitle={fyRange(p.fy)}
        actions={<Link href="/closing" className="btn-secondary">Alla år</Link>}
      />
      <Flash error={error} notice={notice} />

      {p.fy.closedAt ? (
        <Card title="Räkenskapsåret är stängt" className="max-w-3xl">
          <div className="space-y-4 px-5 pb-5 pt-1 text-[14px]">
            <p className="text-muted">Stängt {dateStr(p.fy.closedAt)}. Inga fler verifikat kan bokföras i året.</p>
            {closingVerifications.length > 0 && (
              <ul className="space-y-1">
                {closingVerifications.map((v) => (
                  <li key={v.id}>
                    <Link href={`/verifications/${v.id}`} className="text-brand">
                      {v.series}
                      {v.number}
                    </Link>{" "}
                    {v.description} <span className="text-muted">({dateStr(v.date)})</span>
                  </li>
                ))}
              </ul>
            )}
            <form action={reopenYearAction}>
              <input type="hidden" name="id" value={p.fy.id} />
              <ConfirmButton className="btn-danger" message="Ångra bokslutet? Bokslutsverifikaten makuleras och året öppnas igen.">
                Ångra bokslut
              </ConfirmButton>
            </form>
          </div>
        </Card>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <Card title="1. Kontroller">
              <ul className="space-y-2 px-5 pb-5 pt-1">
                {p.checks.map((c, i) => (
                  <li key={i} className="flex items-start gap-3 text-[14px]">
                    <span
                      className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${c.ok ? "bg-success-soft text-success" : c.blocking ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn"}`}
                    >
                      {c.ok ? <Icon name="check" className="h-3 w-3" /> : "!"}
                    </span>
                    <span className="flex-1">
                      {c.text}{" "}
                      {!c.ok && c.href && (
                        <Link href={c.href} className="text-brand">
                          Åtgärda
                        </Link>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="2. Resultat och skatt">
              <div className="px-5 pb-5 pt-1">
                <dl className="space-y-2 text-[14px]">
                  <div className="flex justify-between">
                    <dt>Resultat före skatt</dt>
                    <dd className="num font-medium">{kr(p.resultBeforeTax)}</dd>
                  </div>
                  {p.hasTax && (
                    <>
                      {p.nonDeductible !== 0 && (
                        <div className="flex justify-between text-muted">
                          <dt>+ Ej avdragsgilla kostnader</dt>
                          <dd className="num">{kr(p.nonDeductible)}</dd>
                        </div>
                      )}
                      <div className="flex justify-between text-muted">
                        <dt>Skattemässigt resultat (avrundat nedåt till hela 100 kr)</dt>
                        <dd className="num">{kr(p.taxable)}</dd>
                      </div>
                      {p.bookedTax !== 0 && (
                        <div className="flex justify-between text-muted">
                          <dt>Redan bokförd skatt</dt>
                          <dd className="num">{kr(p.bookedTax)}</dd>
                        </div>
                      )}
                    </>
                  )}
                </dl>
                {p.hasTax ? (
                  <form className="mt-4 flex flex-wrap items-end gap-3 rounded-xl bg-surface-2 p-3">
                    <div className="min-w-40 flex-1">
                      <label className="label" htmlFor="tax">
                        Bolagsskatt att bokföra (förslag {(CORPORATE_TAX_RATE * 100).toLocaleString("sv-SE")} %: {kr(p.suggestedTax, { decimals: false })})
                      </label>
                      <input id="tax" name="tax" inputMode="decimal" defaultValue={num(p.tax).replace(/\s/g, "")} className="input text-right" />
                    </div>
                    <button className="btn-secondary">Räkna om</button>
                  </form>
                ) : (
                  <p className="mt-3 text-[13px] text-muted">
                    Enskilda firmor och handelsbolag betalar inte bolagsskatt; ägarna beskattas för resultatet i sina egna deklarationer.
                  </p>
                )}
                <div className="mt-4 flex justify-between border-t border-line pt-3 text-[16px] font-semibold">
                  <span>Årets resultat</span>
                  <span className={`num ${p.result < 0 ? "text-danger" : "text-success"}`}>{kr(p.result)}</span>
                </div>
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <Card title="3. Verifikat som bokförs">
              <div className="space-y-3 px-5 pb-5 pt-1">
                {p.entries.map((e, i) => (
                  <Entry key={i} title={e.title} date={e.date} lines={e.lines} names={names} />
                ))}
                {carry.length > 0 && <Entry title="Omföring av föregående års resultat" date={p.nextStart} lines={carry} names={names} />}
                {p.entries.length === 0 && carry.length === 0 && <p className="text-[14px] text-muted">Inget behöver bokföras – året har inget resultat.</p>}
              </div>
            </Card>

            <Card title={`4. Ingående balanser ${dateStr(p.nextStart)}`}>
              <div className="px-5 pb-5 pt-1">
                <p className="mb-3 text-[13px] text-muted">Utgående saldon efter bokslutet förs över som ingående balanser till nästa räkenskapsår.</p>
                {ibRows.length === 0 ? (
                  <p className="text-[14px] text-muted">Inga saldon.</p>
                ) : (
                  <table className="table">
                    <tbody>
                      {ibRows.map(([a, v]) => (
                        <tr key={a}>
                          <td className="w-16">{a}</td>
                          <td className="text-muted">{names.get(a)}</td>
                          <td className="num">{num(a < 2000 ? v : -v)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-semibold">
                        <td className="px-4 py-2.5" colSpan={2}>Summa tillgångar = eget kapital och skulder</td>
                        <td className="num px-4">{num(assets)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </Card>

            <form action={closeYearAction} className="card flex flex-wrap items-center gap-3 p-4">
              <input type="hidden" name="id" value={p.fy.id} />
              <input type="hidden" name="tax" value={p.hasTax ? num(p.tax).replace(/\s/g, "") : ""} />
              <p className="flex-1 text-[13px] text-muted">
                Bokför verifikaten ovan och stäng {fyLabel(p.fy)}. Det går att ångra så länge nästa år inte är stängt.
              </p>
              {p.canClose ? (
                <ConfirmButton message={`Bokför bokslutet och stäng räkenskapsåret ${fyLabel(p.fy)}?`}>Bokför bokslut och stäng året</ConfirmButton>
              ) : (
                <button disabled className="btn-primary">Bokför bokslut och stäng året</button>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
