import type { FiscalYear } from "@prisma/client";
import { fyLabel } from "@/lib/fiscal";

/** Filterformulär med val av räkenskapsår (parametern "fy" är räkenskapsårets id). */
export function YearForm({ years, fy, children }: { years: FiscalYear[]; fy: FiscalYear; children?: React.ReactNode }) {
  return (
    <form className="no-print flex flex-wrap items-end gap-3 border-b border-line p-4">
      <div>
        <label className="label" htmlFor="fy">Räkenskapsår</label>
        <select id="fy" name="fy" defaultValue={fy.id} className="input w-48">
          {[...years].reverse().map((y) => (
            <option key={y.id} value={y.id}>
              {fyLabel(y)}
              {y.closedAt ? " (stängt)" : ""}
            </option>
          ))}
        </select>
      </div>
      {children}
      <button className="btn-secondary">Visa</button>
    </form>
  );
}
