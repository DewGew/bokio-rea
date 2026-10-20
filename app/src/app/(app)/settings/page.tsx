import { requireCompany } from "@/lib/auth";
import { Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { saveCompany } from "../registers/actions";

const FIELDS: [string, string][] = [
  ["name", "Företagsnamn *"],
  ["orgNumber", "Organisationsnummer *"],
  ["vatNumber", "Momsregistreringsnummer"],
  ["email", "E-post"],
  ["address", "Adress"],
  ["postalCode", "Postnummer"],
  ["city", "Ort"],
  ["bankgiro", "Bankgiro"],
  ["invoiceDays", "Betalningsvillkor (dagar)"],
];

export default async function Settings({ searchParams }: { searchParams: SP }) {
  const { error, notice } = await readParams(searchParams);
  const { company: c } = await requireCompany();
  return (
    <>
      <PageHeader title="Företagsinställningar" subtitle="Uppgifterna visas på dina fakturor" />
      <Flash error={error} notice={notice} />
      <Card className="max-w-2xl">
        <form action={saveCompany} className="grid gap-4 p-4 sm:grid-cols-2">
          {FIELDS.map(([name, label]) => (
            <div key={name} className={name === "name" ? "sm:col-span-2" : ""}>
              <label className="label" htmlFor={name}>{label}</label>
              <input id={name} name={name} defaultValue={String(c[name as keyof typeof c] ?? "")} required={label.endsWith("*")} className="input" />
            </div>
          ))}
          <div className="flex justify-end sm:col-span-2">
            <ConfirmButton>Spara</ConfirmButton>
          </div>
        </form>
      </Card>
    </>
  );
}
