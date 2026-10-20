import { db } from "@/lib/db";

export async function yearsWithData(companyId: number) {
  const ys = (await db.verification.findMany({ where: { companyId }, distinct: ["year"], select: { year: true }, orderBy: { year: "desc" } })).map((v) => v.year);
  const now = new Date().getUTCFullYear();
  return ys.includes(now) ? ys : [now, ...ys];
}

export function YearForm({ years, year, extra, children }: { years: number[]; year: number; extra?: Record<string, string>; children?: React.ReactNode }) {
  return (
    <form className="no-print flex flex-wrap items-end gap-3 border-b border-line p-4">
      {extra && Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div>
        <label className="label" htmlFor="year">Räkenskapsår</label>
        <select id="year" name="year" defaultValue={year} className="input w-32">
          {years.map((y) => <option key={y}>{y}</option>)}
        </select>
      </div>
      {children}
      <button className="btn-secondary">Visa</button>
    </form>
  );
}
