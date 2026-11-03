import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { balances, sumRange } from "@/lib/accounting";
import { currentFiscalYear, fyLabel } from "@/lib/fiscal";
import { kr } from "@/lib/money";
import { Card, Flash, PageHeader } from "@/components/ui";
import { addTaxPartnerAction, deleteTaxPartnerAction, saveTaxPartnerAction } from "./actions";

const money = (value: number) => kr(Math.round(value * 100));
const pct = (value: number) => value.toLocaleString("sv-SE", { maximumFractionDigits: 2 }) + " %";

export default async function AnnualTaxPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { companyId, company, role } = await requireCompany();
  const params = await searchParams;
  if (!["ef", "hb"].includes(company.companyType)) {
    return <><PageHeader title="Årets skatt" /><Card><p className="p-5 text-sm text-muted">Skatteuppskattningen är tillgänglig för enskild firma och handelsbolag.</p></Card></>;
  }
  const [fy, partners] = await Promise.all([
    currentFiscalYear(companyId),
    db.taxPartner.findMany({ where: { companyId }, orderBy: { id: "asc" } }),
  ]);
  const yearBalances = await balances(companyId, { from: fy.start, to: fy.end });
  const profit = -sumRange(yearBalances, 3000, 8989) / 100;
  const shares = partners.reduce((sum, partner) => sum + partner.sharePercent, 0);
  const canWrite = role !== "read";
  const year = new Date().getFullYear();

  return (
    <>
      <PageHeader title="Årets skatt" subtitle={"Preliminär uppskattning för räkenskapsår " + fyLabel(fy)} />
      <Flash error={params.error} notice={params.ok} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="card p-5"><p className="text-[13px] text-muted">Bokfört resultat hittills</p><p className="mt-1 text-2xl font-semibold tabular-nums">{money(profit)}</p></div>
        <div className="card p-5"><p className="text-[13px] text-muted">Fördelade resultatandelar</p><p className="mt-1 text-2xl font-semibold tabular-nums">{pct(shares)}</p><p className="mt-1 text-xs text-muted">Andelarna bör tillsammans vara 100 %.</p></div>
      </div>
      {company.companyType === "hb" && shares !== 100 && partners.length > 0 && (
        <div className="mb-5 rounded-xl bg-warn-soft p-4 text-sm text-warn">Resultatandelarna summerar till {pct(shares)}. Justera dem till 100 % för en fullständig fördelning.</div>
      )}
      <div className="space-y-5">
        {partners.map((partner) => {
          const partnerProfit = profit * partner.sharePercent / 100;
          const deduction = partner.activityType === "active" ? Math.max(0, partnerProfit * 0.25) : 0;
          const taxable = Math.max(0, partnerProfit - deduction);
          const rate = partner.activityType === "active" ? 0.2897 : 0.2426;
          const contributions = Math.max(0, partner.activityType === "active" ? taxable : partnerProfit) * rate;
          const incomeTax = taxable * partner.municipalityTaxRate / 100;
          const total = contributions + incomeTax;
          return (
            <Card key={partner.id} title={partner.name}>
              <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
                {canWrite ? (
                  <form action={saveTaxPartnerAction} className="grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="id" value={partner.id} />
                    <label className="text-sm sm:col-span-2">Namn<input className="input mt-1" name="name" defaultValue={partner.name} required maxLength={100} /></label>
                    <label className="text-sm">Resultatandel (%)<input className="input mt-1" name="sharePercent" type="number" min="0" max="100" step="0.01" defaultValue={partner.sharePercent} required /></label>
                    <label className="text-sm">Födelseår<input className="input mt-1" name="birthYear" type="number" min="1900" max={year} defaultValue={partner.birthYear} required /></label>
                    <label className="text-sm">Kommunalskatt (%)<input className="input mt-1" name="municipalityTaxRate" type="number" min="0" max="60" step="0.01" defaultValue={partner.municipalityTaxRate} required /></label>
                    <label className="text-sm">Verksamhetstyp<select className="input mt-1" name="activityType" defaultValue={partner.activityType}><option value="active">Aktiv näringsverksamhet</option><option value="passive">Passiv näringsverksamhet</option></select></label>
                    <div className="flex items-center gap-2 sm:col-span-2"><button className="btn-primary" type="submit">Spara uppgifter</button></div>
                  </form>
                ) : (
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-muted">Resultatandel</dt><dd>{pct(partner.sharePercent)}</dd></div>
                    <div><dt className="text-muted">Födelseår</dt><dd>{partner.birthYear}</dd></div>
                    <div><dt className="text-muted">Kommunalskatt</dt><dd>{pct(partner.municipalityTaxRate)}</dd></div>
                    <div><dt className="text-muted">Verksamhet</dt><dd>{partner.activityType === "active" ? "Aktiv" : "Passiv"}</dd></div>
                  </dl>
                )}
                <div className="rounded-xl bg-surface-2 p-4">
                  <p className="mb-3 text-sm font-semibold">Uppskattning för delägaren</p>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-muted">Andel av resultatet</dt><dd className="font-medium tabular-nums">{money(partnerProfit)}</dd></div>
                    {partner.activityType === "active" && <div className="flex justify-between gap-3"><dt className="text-muted">Schablonavdrag (25 %)</dt><dd className="tabular-nums">−{money(deduction)}</dd></div>}
                    <div className="flex justify-between gap-3"><dt className="text-muted">Beräknad inkomstskatt</dt><dd className="tabular-nums">{money(incomeTax)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted">{partner.activityType === "active" ? "Egenavgifter (schablon)" : "Särskild löneskatt (schablon)"}</dt><dd className="tabular-nums">{money(contributions)}</dd></div>
                    <div className="mt-2 flex justify-between border-t border-line pt-3 font-semibold"><dt>Att reservera</dt><dd className="tabular-nums">{money(total)}</dd></div>
                  </dl>
                </div>
                {canWrite && <form action={deleteTaxPartnerAction} className="lg:col-span-2"><input type="hidden" name="id" value={partner.id} /><button className="text-sm text-danger hover:underline" type="submit">Ta bort delägare</button></form>}
              </div>
            </Card>
          );
        })}
        {partners.length === 0 && <Card><p className="p-5 text-sm text-muted">Lägg till ägaren eller delägarna för att se en uppskattning av årets skatt.</p></Card>}
        {canWrite && (
          <Card title={company.companyType === "hb" ? "Lägg till delägare" : "Lägg till skatteprofil"}>
            <form action={addTaxPartnerAction} className="flex flex-wrap items-end gap-3 p-5">
              <label className="min-w-[220px] flex-1 text-sm">Namn<input className="input mt-1" name="name" placeholder={company.companyType === "hb" ? "Delägarens namn" : "Ägarens namn"} required maxLength={100} /></label>
              <button className="btn-primary" type="submit">Lägg till</button>
            </form>
          </Card>
        )}
      </div>
      <Card className="mt-6">
        <div className="space-y-2 p-5 text-xs leading-relaxed text-muted">
          <p><strong>Viktigt:</strong> Detta är en förenklad testberäkning, inte en fullständig skatteberäkning eller skatterådgivning. Inkomstskatten beräknas med angiven kommunalskattesats på resultatet efter schablonavdrag för aktiv verksamhet.</p>
          <p>Beräkningen tar ännu inte hänsyn till grundavdrag, jobbskatteavdrag, statlig inkomstskatt, åldersberoende avgiftsnivåer, andra inkomster, avdrag eller individuella skattereduktioner. Skattesatserna för egenavgifter och särskild löneskatt är schabloner. Kontrollera alltid mot Skatteverkets beräkning innan du använder beloppen.</p>
        </div>
      </Card>
    </>
  );
}
