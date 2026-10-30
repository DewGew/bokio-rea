import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { deleteTemplate, saveTemplate } from "../../registers/actions";
import { TemplateLinesEditor } from "@/components/TemplateLinesEditor";



export default async function Templates({ searchParams }: { searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { error, notice } = await readParams(searchParams);
  const [templates, accounts] = await Promise.all([
    db.template.findMany({ where: { companyId }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.account.findMany({ where: { companyId, active: true }, orderBy: { number: "asc" } }),
  ]);
  const names = new Map(accounts.map((a) => [a.number, a.name]));

  return (
    <>
      <PageHeader title="Bokföringsmallar" subtitle="Mallar gör det enkelt att bokföra kvitton utan att kunna debet och kredit" />
      <Flash error={error} notice={notice} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Mall</th>
                  
                  <th>Konteringsrader</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <span className="font-medium">{t.name}</span>
                      <span className="block text-xs text-muted">{t.category}</span>
                    </td>
                    
                    <td className="text-sm">{Array.isArray(t.lines) && t.lines.length ? `${t.lines.length} rader` : `${t.costAccount} ${names.get(t.costAccount) ?? ""} · ${t.vatRate}% moms (äldre mall)`}</td>
                    <td className="text-right">
                      <form action={deleteTemplate}>
                        <input type="hidden" name="id" value={t.id} />
                        <ConfirmButton className="text-xs text-danger" message={`Ta bort mallen ${t.name}?`}>Ta bort</ConfirmButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Ny mall">
          <form action={saveTemplate} className="grid gap-3 p-4">
            <div>
              <label className="label" htmlFor="name">Namn</label>
              <input id="name" name="name" required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="category">Kategori</label>
              <input id="category" name="category" placeholder="T.ex. Inköp" className="input" />
            </div>
            
            <div>
              <label className="label" htmlFor="vatRate">Momsnivå för beräkning av netto och moms</label>
              <select id="vatRate" name="vatRate" className="input">
                <option value="25">25 %</option>
                <option value="12">12 %</option>
                <option value="6">6 %</option>
                <option value="0">0 %</option>
              </select>
            </div>
            <div>
              <label className="label">Konteringsrader</label>
              <TemplateLinesEditor accounts={accounts} />
            </div>
            <div>
              <label className="label" htmlFor="keywords">Sökord</label>
              <input id="keywords" name="keywords" placeholder="Ord som hjälper dig hitta mallen" className="input" />
            </div>
            <div className="flex justify-end">
              <ConfirmButton>Skapa mall</ConfirmButton>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
