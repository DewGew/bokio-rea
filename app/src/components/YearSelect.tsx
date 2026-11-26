/** Filterformulär för rapporter. Räkenskapsåret väljs centralt i sidopanelen, så här finns bara övriga filter. */
export function YearForm({ children }: { children: React.ReactNode }) {
  return (
    <form className="no-print flex flex-wrap items-end gap-3 border-b border-line p-4">
      {children}
      <button className="btn-secondary">Visa</button>
    </form>
  );
}
