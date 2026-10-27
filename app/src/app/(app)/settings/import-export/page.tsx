import { requireCompany } from "@/lib/auth";
import { currentFiscalYear, fiscalYears, fyLabel } from "@/lib/fiscal";
import { Card, PageHeader } from "@/components/ui";
import { SieImporter } from "@/components/SieImporter";

export default async function ImportExport() {
  const { companyId } = await requireCompany();
  const [years, current] = await Promise.all([fiscalYears(companyId), currentFiscalYear(companyId)]);

  return (
    <>
      <PageHeader title="Import och export" subtitle="Flytta bokföring mellan Kapima Bokför och andra program med SIE-filer, standardformatet i Sverige." />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title="Importera SIE-fil">
          <div className="px-5 pb-5 pt-1">
            <SieImporter />
          </div>
        </Card>

        <div className="space-y-6">
          <Card title="Exportera SIE-fil">
            <form action="/api/sie/export" method="get" className="space-y-3 px-5 pb-5 pt-1">
              <p className="text-[14px] text-muted">
                SIE typ 4 med kontoplan, ingående och utgående balanser, resultat och alla verifikat. Kan läsas in i Fortnox, Visma, Bokio och av de flesta revisorer.
              </p>
              <div>
                <label className="label" htmlFor="fy">Räkenskapsår</label>
                <select id="fy" name="fy" defaultValue={current.id} className="input">
                  {[...years].reverse().map((y) => (
                    <option key={y.id} value={y.id}>
                      {fyLabel(y)}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn-primary w-full">Ladda ner SIE-fil</button>
            </form>
          </Card>

          <Card title="Exportera underlag (ZIP)">
            <form action="/api/underlag/export" method="get" className="space-y-3 px-5 pb-5 pt-1">
              <p className="text-[14px] text-muted">
                Alla uppladdade underlag som är bokförda under räkenskapsåret, ordnade i mappar per verifikat, samt PDF-kopior av årets utfärdade fakturor.
                En indexfil (CSV) visar vilken fil som hör till vilket verifikat. SIE-filer innehåller inga underlag, så ladda ner dem här också.
              </p>
              <div className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
                Stora år med många filer kan ta flera minuter. Låt fönstret vara öppet tills nedladdningen är klar. Kontrollera att indexfilen inte
                markerar några filer som saknade i lagringen.
              </div>
              <div>
                <label className="label" htmlFor="ufy">Räkenskapsår</label>
                <select id="ufy" name="fy" defaultValue={current.id} className="input">
                  {[...years].reverse().map((y) => (
                    <option key={y.id} value={y.id}>
                      {fyLabel(y)}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn-primary w-full">Ladda ner underlag</button>
            </form>
          </Card>

          <Card title="Så exporterar du från ditt gamla program">
            <div className="space-y-3 px-5 pb-5 pt-1 text-[14px]">
              <p className="text-muted">
                Leta efter <strong>Exportera SIE</strong> (typ 4, ibland kallad &quot;SIE 4E&quot;) i Fortnox, Visma eEkonomi eller Bokio. Exportera ett räkenskapsår per fil.
              </p>
              <ol className="list-decimal space-y-1.5 pl-5 text-muted">
                <li>Ställ in företagsform, momsperiod och räkenskapsår under <em>Räkenskapsår och moms</em> först.</li>
                <li>Importera det äldsta året först och fortsätt år för år.</li>
                <li>Kryssa i <em>Momsen är redan redovisad</em> och <em>Stäng räkenskapsåret</em> för år som är klara i det gamla programmet.</li>
                <li>Kunder, fakturor och underlag ingår inte i SIE-formatet.</li>
              </ol>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
