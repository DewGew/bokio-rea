import { requireCompany } from "@/lib/auth";
import { isTemplate } from "@/lib/invoice-design";
import { PageHeader } from "@/components/ui";
import { InvoiceDesigner } from "@/components/InvoiceDesigner";

export default async function InvoiceDesignPage() {
  const { company: c } = await requireCompany();
  return (
    <>
      <PageHeader title="Fakturadesign" subtitle="Välj mall, färg och logotyp. Ändringarna syns direkt i förhandsvisningen." />
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
          iban: c.iban,
          bic: c.bic,
          phone: c.phone,
          website: c.website,
        }}
      />
    </>
  );
}
