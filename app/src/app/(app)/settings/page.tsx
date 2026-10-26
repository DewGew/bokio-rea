import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { companyBookkeeping } from "@/lib/company-delete";
import { COMPANY_TYPES } from "@/lib/company-setup";
import { Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { saveCompany } from "../registers/actions";
import { deleteCompanyAction } from "./delete-company-action";

type Field = { name: string; label: string; hint?: string; required?: boolean; type?: string; wide?: boolean };

const IDENTITY: Field[] = [
  { name: "name", label: "Registrerat företagsnamn *", hint: "Exakt som hos Bolagsverket (för enskild firma: ditt namn eller registrerat firmanamn).", required: true, wide: true },
  { name: "tradeName", label: "Varumärke / särskilt företagsnamn", hint: "Visas överst på fakturan om det skiljer sig från det registrerade namnet." },
  { name: "orgNumber", label: "Organisationsnummer *", hint: "Format 556677-8899 (personnummer för enskild firma).", required: true },
  { name: "vatNumber", label: "Momsregistreringsnummer", hint: "SE + organisationsnumret + 01, t.ex. SE556677889901." },
  { name: "seat", label: "Styrelsens säte (kommun)", hint: "Krävs på aktiebolags fakturor (28 kap. 5 § aktiebolagslagen)." },
];
const CONTACT: Field[] = [
  { name: "address", label: "Adress", wide: true },
  { name: "postalCode", label: "Postnummer" },
  { name: "city", label: "Ort" },
  { name: "email", label: "E-post", type: "email" },
  { name: "phone", label: "Telefon" },
  { name: "website", label: "Webbplats" },
  { name: "bankgiro", label: "Bankgiro" },
];

export default async function Settings({ searchParams }: { searchParams: SP }) {
  const { error, notice } = await readParams(searchParams);
  const { company: c, role, companies } = await requireCompany();
  const bookkeeping = role === "owner" && companies.length > 1 ? await companyBookkeeping(c.id) : null;
  const value = (k: string) => String(c[k as keyof typeof c] ?? "");
  const input = (f: Field) => (
    <div key={f.name} className={f.wide ? "sm:col-span-2" : ""}>
      <label className="label" htmlFor={f.name}>{f.label}</label>
      <input id={f.name} name={f.name} type={f.type ?? "text"} defaultValue={value(f.name)} required={f.required} className="input" />
      {f.hint && <p className="mt-1 text-[12px] text-muted">{f.hint}</p>}
    </div>
  );
  const typeLabel = COMPANY_TYPES[c.companyType as keyof typeof COMPANY_TYPES] ?? c.companyType;

  return (
    <>
      <PageHeader title="Företagsinställningar" subtitle="Uppgifterna hämtas automatiskt till dina fakturor. Utfärdade fakturor behåller uppgifterna som gällde då." />
      <Flash error={error} notice={notice} />
      <form action={saveCompany} className="grid max-w-5xl items-start gap-6 lg:grid-cols-2">
        <Card title="Företag">
          <div className="grid gap-4 px-5 pb-5 pt-1 sm:grid-cols-2">
            <p className="text-[13px] text-muted sm:col-span-2">
              Företagsform: <strong className="text-ink">{typeLabel}</strong> · Moms: <strong className="text-ink">{c.vatPeriod === "none" ? "ej momsregistrerat" : "momsregistrerat"}</strong> ·{" "}
              <Link href="/settings/fiscal" className="text-brand">Ändra</Link>
            </p>
            {IDENTITY.map(input)}
            <label className="flex items-start gap-2 text-[14px] sm:col-span-2">
              <input type="checkbox" name="fSkatt" defaultChecked={c.fSkatt} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
              <span>
                <span className="font-medium">Godkänd för F-skatt</span>
                <span className="block text-[12px] text-muted">Kryssa bara i om Skatteverket har godkänt företaget för F-skatt. Texten visas då på fakturan.</span>
              </span>
            </label>
          </div>
        </Card>

        <div className="space-y-6">
          <Card title="Adress och kontakt">
            <div className="grid gap-4 px-5 pb-5 pt-1 sm:grid-cols-2">
              {CONTACT.map(input)}
              <p className="text-[12px] text-muted sm:col-span-2">
                Plusgiro, IBAN, Swish och logotyp ställer du in under <Link href="/invoices/design" className="text-brand">Fakturadesign</Link>.
              </p>
            </div>
          </Card>

          <Card title="Betalningsvillkor">
            <div className="grid gap-4 px-5 pb-5 pt-1 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="invoiceDays">Betalningsvillkor (dagar)</label>
                <input id="invoiceDays" name="invoiceDays" type="number" min={0} max={365} defaultValue={c.invoiceDays} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="lateInterestRate">Dröjsmålsränta (% per år)</label>
                <input id="lateInterestRate" name="lateInterestRate" inputMode="decimal" defaultValue={c.lateInterestRate ?? ""} placeholder="Enligt räntelagen" className="input" />
                <p className="mt-1 text-[12px] text-muted">Tomt = enligt räntelagen (referensräntan + 8 procentenheter). Ange en egen sats bara om den är avtalad.</p>
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="reminderFee">Påminnelseavgift (kr)</label>
                <input id="reminderFee" name="reminderFee" inputMode="decimal" defaultValue={c.reminderFee ? (c.reminderFee / 100).toString() : ""} placeholder="Ingen" className="input sm:w-40" />
                <p className="mt-1 text-[12px] text-muted">
                  Högst 60 kr, och får bara tas ut om den är avtalad med kunden i förväg (lagen om ersättning för inkassokostnader). Läggs aldrig till automatiskt – texten visas bara på fakturan.
                </p>
              </div>
              <div className="flex justify-end sm:col-span-2">
                <ConfirmButton>Spara</ConfirmButton>
              </div>
            </div>
          </Card>
        </div>
      </form>
      {role === "owner" && (
        <div className="mt-6 max-w-5xl">
          <Card title="Ta bort företag">
            <div className="space-y-3 px-5 pb-5 pt-1 text-[14px]">
              {companies.length < 2 ? (
                <p className="text-muted">Du kan bara ta bort ett företag när du har minst ett annat företag att växla till.</p>
              ) : bookkeeping?.blocked ? (
                <p className="text-muted">
                  {c.name} har bokföring och kan inte tas bort. Bokföring ska bevaras i sju år enligt bokföringslagen. Exportera en SIE-fil under{" "}
                  <Link href="/settings/import-export" className="text-brand">Import och export</Link> och spara den på ett säkert ställe.
                </p>
              ) : (
                <form action={deleteCompanyAction} className="space-y-3">
                  <p className="text-muted">
                    Tar bort <strong className="text-ink">{c.name}</strong> permanent, med kunder, artiklar, utkast och uppladdade filer. Det går inte att ångra.
                    Skriv företagets namn för att bekräfta.
                  </p>
                  <input name="confirmName" required autoComplete="off" placeholder={c.name} aria-label="Bekräfta företagsnamn" className="input sm:max-w-sm" />
                  <div>
                    <ConfirmButton className="btn-danger" message={`Ta bort ${c.name} permanent?`}>Ta bort företaget</ConfirmButton>
                  </div>
                </form>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
