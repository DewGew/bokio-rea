import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { kr } from "@/lib/money";
import { Card, Empty, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { deleteArticle, saveArticle } from "../registers/actions";

export default async function Articles({ searchParams }: { searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { get, error, notice } = await readParams(searchParams);
  const articles = await db.article.findMany({ where: { companyId }, orderBy: { name: "asc" } });
  const editing = articles.find((a) => a.id === Number(get("edit")));

  return (
    <>
      <PageHeader title="Artiklar" subtitle="Varor och tjänster du fakturerar ofta" />
      <Flash error={error} notice={notice} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          {articles.length === 0 ? (
            <Empty>Inga artiklar ännu.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Namn</th>
                    <th>Typ</th>
                    <th className="num">Pris exkl. moms</th>
                    <th className="num">Moms</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {articles.map((a) => (
                    <tr key={a.id}>
                      <td className="font-medium">{a.name}</td>
                      <td>{a.type === "goods" ? "Vara" : "Tjänst"}</td>
                      <td className="num">{kr(a.price)} / {a.unit}</td>
                      <td className="num">{a.vatRate} %</td>
                      <td className="text-right"><a href={`/articles?edit=${a.id}`} className="text-sm text-brand">Ändra</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title={editing ? `Ändra ${editing.name}` : "Ny artikel"}>
          <form action={saveArticle} className="grid gap-3 p-4" key={editing?.id ?? "new"}>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <div>
              <label className="label" htmlFor="name">Namn *</label>
              <input id="name" name="name" required defaultValue={editing?.name} className="input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="price">Pris exkl. moms *</label>
                <input id="price" name="price" required inputMode="decimal" defaultValue={editing ? (editing.price / 100).toFixed(2).replace(".", ",") : ""} className="input text-right" />
              </div>
              <div>
                <label className="label" htmlFor="unit">Enhet</label>
                <input id="unit" name="unit" defaultValue={editing?.unit ?? "st"} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="vatRate">Moms</label>
                <select id="vatRate" name="vatRate" defaultValue={editing?.vatRate ?? 25} className="input">
                  <option value="25">25 %</option>
                  <option value="12">12 %</option>
                  <option value="6">6 %</option>
                  <option value="0">0 %</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="type">Typ</label>
                <select id="type" name="type" defaultValue={editing?.type ?? "service"} className="input">
                  <option value="service">Tjänst</option>
                  <option value="goods">Vara</option>
                </select>
              </div>
            </div>
            <div className="flex justify-between gap-2">
              {editing ? <a href="/articles" className="btn-secondary">Avbryt</a> : <span />}
              <ConfirmButton>{editing ? "Spara" : "Lägg till artikel"}</ConfirmButton>
            </div>
          </form>
          {editing && (
            <form action={deleteArticle} className="border-t border-line p-4">
              <input type="hidden" name="id" value={editing.id} />
              <ConfirmButton className="btn-danger" message="Ta bort artikeln?">Ta bort artikel</ConfirmButton>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}
