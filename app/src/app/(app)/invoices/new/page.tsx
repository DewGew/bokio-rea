import Link from "next/link";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { Card, Empty, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { createDraft } from "../actions";

export default async function NewInvoice({ searchParams }: { searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { error } = await readParams(searchParams);
  const customers = await db.customer.findMany({ where: { companyId }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="Ny faktura" subtitle="Börja med att välja kund" />
      <Flash error={error} />
      <Card className="max-w-xl p-4">
        {customers.length === 0 ? (
          <Empty href="/customers" cta="Lägg till kund">Du har inga kunder ännu.</Empty>
        ) : (
          <form action={createDraft} className="space-y-4">
            <div>
              <label className="label" htmlFor="customerId">Kund</label>
              <select id="customerId" name="customerId" className="input">
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between">
              <Link href="/customers" className="text-sm text-brand">+ Ny kund</Link>
              <ConfirmButton>Skapa utkast</ConfirmButton>
            </div>
          </form>
        )}
      </Card>
    </>
  );
}
