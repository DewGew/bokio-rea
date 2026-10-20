import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { invoiceTotals } from "@/lib/accounting";
import { kr } from "@/lib/money";
import { Card, Empty, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { deleteCustomer, saveCustomer } from "../registers/actions";

const FIELDS: [string, string, string?][] = [
  ["name", "Namn *"],
  ["orgNumber", "Org.nr / personnr"],
  ["email", "E-post", "email"],
  ["reference", "Referens"],
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
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Namn</th>
                    <th className="hidden md:table-cell">Org.nr</th>
                    <th className="hidden md:table-cell">E-post</th>
                    <th className="num">Fakturerat</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id}>
                      <td className="font-medium">{c.name}</td>
                      <td className="hidden md:table-cell">{c.orgNumber}</td>
                      <td className="hidden md:table-cell">{c.email}</td>
                      <td className="num">
                        {kr(c.invoices.filter((i) => i.status === "sent" || i.status === "paid").reduce((s, i) => s + invoiceTotals(i.lines).total, 0))}
                      </td>
                      <td className="text-right">
                        <a href={`/customers?edit=${c.id}`} className="text-sm text-brand">Ändra</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <div className="flex justify-between gap-2">
              {editing ? <a href="/customers" className="btn-secondary">Avbryt</a> : <span />}
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
