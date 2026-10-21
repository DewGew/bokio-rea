import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { BookingWizard } from "@/components/BookingWizard";
import { directUploadEnabled, serverUploadLimit } from "@/lib/storage";
import { createManualVerification } from "../actions";

export default async function NewVerification({ searchParams }: { searchParams: SP }) {
  const { companyId, company } = await requireCompany();
  const { error } = await readParams(searchParams);
  const [accounts, templates] = await Promise.all([
    db.account.findMany({ where: { companyId, active: true }, orderBy: { number: "asc" }, select: { number: true, name: true } }),
    db.template.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Bokför" subtitle="Välj vad det gäller, fyll i summan – vi räknar ut kontering och moms." />
      <Flash error={error} />
      <BookingWizard
        templates={templates}
        accounts={accounts}
        noVat={company.vatPeriod === "none"}
        manualAction={createManualVerification}
        uploader={{ blob: directUploadEnabled(), limit: serverUploadLimit(), companyId }}
        back="/verifications/new"
      />
    </>
  );
}
