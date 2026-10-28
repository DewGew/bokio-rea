import { requireCompany } from "@/lib/auth";
import { isTemplate } from "@/lib/invoice-design";
import { db } from "@/lib/db";
import { Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { setStartInvoiceNumber } from "./actions";
import { InvoiceDesigner } from "@/components/InvoiceDesigner";

export default async function InvoiceDesignPage({ searchParams }: { searchParams: SP }) {
  const { company: c, companyId } = await requireCompany();
  const { notice, error } = await readParams(searchParams);
  const issued = await db.invoice.count({ where: { companyId, number: { not: null } } });
  return (
    <>
      <PageHeader title="Fakturadesign" subtitle="Välj mall, färg och logotyp. Ändringarna syns direkt i förhandsvisningen." />
      <Flash notice={notice} error={error} />
      <Card title="Fakturanumrering" className="mb-6 max-w-3xl">
        <div className="space-y-3 px-5 pb-5 pt-1 text-[14px]">
          <p>
            Nästa faktura får nummer <strong>{c.invoiceCounter + 1}</strong>.
          </p>
          {issued === 0 ? (
            <form action={setStartInvoiceNumber} className="space-y-3">
              <p className="text-muted">
                Välj vilket nummer fakturorna ska börja på, till exempel 1, 10, 100 eller 1000. Det går bara att ändra innan den första fakturan har utfärdats.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="label" htmlFor="start">Startnummer</label>
                  <input id="start" name="start" inputMode="numeric" pattern="[0-9]*" list="start-presets" required defaultValue={c.invoiceCounter + 1} className="input w-40" />
                  <datalist id="start-presets">
                    {[1, 10, 100, 1000].map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </div>
                <button className="btn-secondary">Spara startnummer</button>
              </div>
            </form>
          ) : (
            <p className="text-muted">
              Numreringen kan inte ändras eftersom {issued === 1 ? "en faktura" : `${issued} fakturor`} redan har utfärdats. Fakturanummer ska vara löpande och unika.
            </p>
          )}
        </div>
      </Card>
      <InvoiceDesigner
        hasLogo={!!c.logoStoredName}
        initial={{
          template: isTemplate(c.invoiceTemplate) ? c.invoiceTemplate : "modern",
          color: c.invoiceColor,
          footer: c.invoiceFooter,
          swishNumber: c.swishNumber,
          swishQr: c.swishQr,
          paymentLink: c.paymentLink,
          bankgiro: c.bankgiro,
          plusgiro: c.plusgiro,
          showOcr: c.showOcr,
          bankName: c.bankName,
          bankAccount: c.bankAccount,
          iban: c.iban,
          bic: c.bic,
          phone: c.phone,
          website: c.website,
        }}
      />
    </>
  );
}
