import Link from "next/link";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { Card, Empty, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { createQuote } from "../actions";

export default async function NewQuote({ searchParams }: { searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { get, error } = await readParams(searchParams);
  const customers = await db.customer.findMany({ where: { companyId }, orderBy: { name: "asc" } });
  const today = new Date().toISOString().slice(0, 10);
  const valid = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return <>
    <PageHeader title="Ny offert" subtitle="Skapa en offert till en kund" actions={<Link href="/quotes" className="btn-secondary">Tillbaka</Link>} />
    <Flash error={error} />
    <Card className="max-w-xl p-4">
      {customers.length === 0 ? <Empty href="/customers" cta="Lägg till kund">Du har inga kunder ännu.</Empty> : <form action={createQuote} className="space-y-4">
        <div><label className="label" htmlFor="customerId">Kund</label><select id="customerId" name="customerId" className="input" defaultValue={get("customer") ?? String(customers[0].id)}>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><Link href="/customers" className="mt-2 inline-block text-sm text-brand">+ Ny kund</Link></div>
        <div><label className="label" htmlFor="date">Offertdatum</label><input id="date" name="date" type="date" defaultValue={today} required className="input" /></div>
        <div><label className="label" htmlFor="validUntil">Giltig till</label><input id="validUntil" name="validUntil" type="date" defaultValue={valid} min={today} required className="input" /></div>
        <div className="flex justify-end"><button className="btn-primary">Skapa offertutkast</button></div>
      </form>}
    </Card>
  </>;
}
