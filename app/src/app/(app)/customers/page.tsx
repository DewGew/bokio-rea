import Link from "next/link";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { invoiceTotals } from "@/lib/accounting";
import { Card, Empty, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { CustomerTable } from "@/components/CustomerTable";
import { COUNTRIES } from "@/lib/invoice-doc";
import { deleteCustomer, saveCustomer } from "../registers/actions";

const FIELDS: [string, string, string?][] = [
  ["name", "Namn *"],
  ["orgNumber", "Org.nr / personnr"],
  ["vatNumber", "Momsreg.nr (krävs vid EU-handel)"],
  ["email", "E-post för fakturor", "email"],
  ["reference", "Kontaktperson / er referens"],
  ["address", "Adress"],
  ["postalCode", "Postnummer"],
  ["city", "Ort"],
];

export default async function Customers({ searchParams }: { searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { get, error, notice } = await readParams(searchParams);
  const editId = Number(get("edit"));
  const customers = await db.customer.findMany({ where: { companyId }, orderBy: { name: "asc" }, include: { invoices: { include: { lines: true } } } });
  const editing = customers.find((c) => c.id === editId);

  return (
    <>
      <PageHeader title="Kunder" />
      <Flash error={error} notice={notice} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          {customers.length === 0 ? (
            <Empty>Inga kunder ännu.</Empty>
          ) : (
            <CustomerTable
              rows={customers.map((c) => {
                const booked = c.invoices.filter((i) => i.status === "sent" || i.status === "paid");
                return {
                  id: c.id,
                  name: c.name,
                  orgNumber: c.orgNumber,
                  email: c.email,
                  city: c.city,
                  reference: c.reference,
                  invoices: c.invoices.filter((i) => i.status !== "draft" && i.kind !== "credit").length,
                  invoiced: booked.reduce((s, i) => s + invoiceTotals(i.lines).total, 0),
                  unpaid: c.invoices.filter((i) => i.status === "sent").reduce((s, i) => s + invoiceTotals(i.lines).total, 0),
                };
              })}
            />
          )}
        </Card>
        <Card title={editing ? `Ändra ${editing.name}` : "Ny kund"}>
          <form action={saveCustomer} className="grid gap-3 p-4" key={editing?.id ?? "new"}>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            {FIELDS.map(([name, label, type]) => (
              <div key={name}>
                <label className="label" htmlFor={name}>{label}</label>
                <input
                  id={name}
                  name={name}
                  type={type ?? "text"}
                  required={name === "name"}
                  defaultValue={editing ? String(editing[name as keyof typeof editing] ?? "") : ""}
                  className="input"
                />
              </div>
            ))}
            <div>
              <label className="label" htmlFor="country">Land</label>
              <select id="country" name="country" defaultValue={editing?.country ?? "SE"} className="input">
                {Object.entries(COUNTRIES).map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-between gap-2">
              {editing ? <Link href="/customers" className="btn-secondary">Avbryt</Link> : <span />}
              <ConfirmButton>{editing ? "Spara" : "Lägg till kund"}</ConfirmButton>
            </div>
          </form>
          {editing && editing.invoices.length === 0 && (
            <form action={deleteCustomer} className="border-t border-line p-4">
              <input type="hidden" name="id" value={editing.id} />
              <ConfirmButton className="btn-danger" message="Ta bort kunden?">Ta bort kund</ConfirmButton>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}
