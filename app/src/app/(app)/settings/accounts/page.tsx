import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { saveAccount, toggleAccount } from "../../registers/actions";

const CLASSES: [number, string][] = [
  [1, "Tillgångar"],
  [2, "Eget kapital och skulder"],
  [3, "Intäkter"],
  [4, "Varor och material"],
  [5, "Övriga externa kostnader"],
  [6, "Övriga externa kostnader"],
  [7, "Personal och avskrivningar"],
  [8, "Finansiella poster och resultat"],
];

export default async function Accounts({ searchParams }: { searchParams: SP }) {
  const { companyId } = await requireCompany();
  const { get, error, notice } = await readParams(searchParams);
  const q = get("q") ?? "";
  const accounts = await db.account.findMany({ where: { companyId }, orderBy: { number: "asc" }, include: { _count: { select: { lines: true } } } });
  const list = accounts.filter((a) => !q || `${a.number} ${a.name}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader title="Kontoplan" subtitle="Baserad på BAS-kontoplanen" />
      <Flash error={error} notice={notice} />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          <form className="border-b border-line p-4">
            <input name="q" defaultValue={q} placeholder="Sök konto…" className="input" aria-label="Sök konto" />
          </form>
          <div className="overflow-x-auto">
            <table className="table">
              {CLASSES.map(([cls, name]) => {
                const rows = list.filter((a) => Math.floor(a.number / 1000) === cls);
                if (rows.length === 0) return null;
                return (
                  <tbody key={cls}>
                    <tr className="bg-surface-2">
                      <th colSpan={4} className="text-ink">{cls}. {name}</th>
                    </tr>
                    {rows.map((a) => (
                      <tr key={a.number} className={a.active ? "" : "text-muted line-through"}>
                        <td className="w-16 font-medium">{a.number}</td>
                        <td>{a.name}</td>
                        <td className="hidden text-xs text-muted sm:table-cell">{a._count.lines ? `${a._count.lines} rader` : ""}</td>
                        <td className="text-right">
                          <form action={toggleAccount}>
                            <input type="hidden" name="number" value={a.number} />
                            <button className="text-xs text-brand">{a.active ? "Inaktivera" : "Aktivera"}</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>
        </Card>
        <Card title="Lägg till eller ändra konto">
          <form action={saveAccount} className="grid gap-3 p-4">
            <div>
              <label className="label" htmlFor="number">Kontonummer</label>
              <input id="number" name="number" required inputMode="numeric" pattern="[1-8][0-9]{3}" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="name">Benämning</label>
              <input id="name" name="name" required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="vatCode">Momskod (för försäljningskonton)</label>
              <select id="vatCode" name="vatCode" className="input">
                <option value="">Ingen</option>
                <option value="25">25 %</option>
                <option value="12">12 %</option>
                <option value="6">6 %</option>
                <option value="0">Momsfri</option>
              </select>
            </div>
            <div className="flex justify-end">
              <ConfirmButton>Spara konto</ConfirmButton>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
