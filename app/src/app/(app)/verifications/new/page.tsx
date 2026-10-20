import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { VerificationEditor } from "@/components/VerificationEditor";
import { directUploadEnabled, serverUploadLimit } from "@/lib/storage";
import { createManualVerification } from "../actions";

export default async function NewVerification({ searchParams }: { searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { error } = await readParams(searchParams);
  const accounts = await db.account.findMany({ where: { companyId, active: true }, orderBy: { number: "asc" }, select: { number: true, name: true } });
  return (
    <>
      <PageHeader title="Nytt verifikat" subtitle="Bokför manuellt med debet och kredit. Tryck = för att balansera en rad." />
      <Flash error={error} />
      <Card className="p-4">
        <VerificationEditor accounts={accounts} action={createManualVerification} uploader={{ blob: directUploadEnabled(), limit: serverUploadLimit(), companyId }} />
      </Card>
    </>
  );
}
