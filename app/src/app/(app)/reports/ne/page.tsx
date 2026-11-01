import { requireCompany } from "@/lib/auth";
import { fyLabel, pickFiscalYear } from "@/lib/fiscal";
import { kr } from "@/lib/money";
import { loadNe } from "@/lib/ne-data";
import { NE_FIELDS, NE_NONE, NE_SCHEMES, type NeAccountRow, type NeScheme } from "@/lib/ne";
import { Card, Flash, PageHeader, readParams, type SP } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { YearForm } from "@/components/YearSelect";
import { setNeMapping, setNeScheme } from "./actions";

const wholeKr = (n: number) => kr(n * 100, { decimals: false });

function MappingRow({ row, fy, readOnly }: { row: NeAccountRow; fy: number; readOnly: boolean }) {
  const current = row.source === "none" ? NE_NONE : row.source === "override" ? row.field! : "default";
  return (
    <tr>
      <td className="whitespace-nowrap">
        <a href={`/reports/ledger?account=${row.number}&fy=${fy}`} className="hover:text-brand">{row.number}</a>
      </td>
      <td>
        {row.name}
        {row.note && row.source === "default" && <span className="block text-[12px] text-warn">{row.note}</span>}
      </td>
      <td className="num whitespace-nowrap">{kr(row.amount)}</td>
      <td className="no-print">
        {readOnly ? (
          <span className="text-muted">{row.field ?? "Ej kopplad"}</span>
        ) : (
          <form action={setNeMapping} className="flex items-center gap-2">
            <input type="hidden" name="account" value={row.number} />
            <input type="hidden" name="fy" value={fy} />
            <select name="field" defaultValue={current} aria-label={`Fält för konto ${row.number}`} className="input w-auto py-1 text-[13px]">
              <option value="default">{row.source === "default" && row.field ? `Standard (${row.field})` : "Standard"}</option>
              {NE_FIELDS.map((f) => (
                <option key={f.code} value={f.code}>{f.code}</option>
              ))}
              <option value={NE_NONE}>Lämna utanför</option>
            </select>
            <button className="btn-secondary px-2 py-1 text-[13px]">Spara</button>
          </form>
        )}
      </td>
    </tr>
  );
}

export default async function NeReport({ searchParams }: { searchParams: SP }) {
  const { company, companyId, role } = await requireCompany();
  const { get, notice, error } = await readParams(searchParams);
  const { all: years, fy } = await pickFiscalYear(companyId, get("fy"));

  if (company.companyType !== "ef") {
    return (
      <>
        <PageHeader title="Underlag för NE-bilaga" />
        <Card>
          <p className="p-5 text-[14px] text-muted">NE-bilagan gäller enskild firma. Ändra företagsform under Inställningar → Räkenskapsår och moms om det här företaget är en enskild firma.</p>
        </Card>
      </>
    );
  }

  const ne = await loadNe(companyId, fy);
  const readOnly = role === "read";
  const income = NE_FIELDS.filter((f) => f.kind === "income");
  const cost = NE_FIELDS.filter((f) => f.kind === "cost");
  const diff = ne.result - ne.booked;
  const allRows = [...NE_FIELDS.flatMap((f) => ne.fields[f.code].accounts), ...ne.unmapped, ...ne.excluded].sort((a, b) => a.number - b.number);

  return (
    <>
      <PageHeader
        title="Underlag för NE-bilaga"
        subtitle={`${company.name} · ${fyLabel(fy)}`}
        actions={
          <div className="no-print flex gap-2">
            <a href={`/api/reports/ne?fy=${fy.id}`} className="btn-secondary">Ladda ner PDF</a>
            <PrintButton />
          </div>
        }
      />
      <Flash notice={notice} error={error} />

      {ne.unmapped.length > 0 && (
        <p className="no-print mb-4 rounded-2xl bg-warn-soft px-4 py-3 text-[14px] text-warn">
          <strong>{ne.unmapped.length === 1 ? "Ett konto har" : `${ne.unmapped.length} konton har`} saldo men saknar fält</strong> och ingår därför inte i summorna. Koppla
          {ne.unmapped.length === 1 ? " det" : " dem"} i listan längst ned.
        </p>
      )}

      <Card title="Vilket bokslut upprättar du?" className="no-print mb-4">
        <form action={setNeScheme} className="space-y-3 px-5 pb-5 pt-1 text-[14px]">
          <input type="hidden" name="fy" value={fy.id} />
          {(Object.keys(NE_SCHEMES) as NeScheme[]).map((k) => (
            <label key={k} className="flex items-start gap-3">
              <input type="radio" name="scheme" value={k} defaultChecked={ne.scheme === k} disabled={readOnly} className="mt-1" />
              <span><span className="font-medium">{NE_SCHEMES[k].label}</span> <span className="text-muted">({NE_SCHEMES[k].plan})</span><span className="block text-muted">{NE_SCHEMES[k].description}</span></span>
            </label>
          ))}
          {!readOnly && <button className="btn-secondary">Spara val</button>}
        </form>
      </Card>

      <Card>
        <YearForm years={years} fy={fy} />
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Fält</th>
                <th>Benämning</th>
                <th className="num">Belopp, hela kr</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-surface-2">
                <th colSpan={3} className="text-ink">Intäkter</th>
              </tr>
              {income.map((f) => (
                <tr key={f.code}>
                  <td className="font-medium">{f.code}</td>
                  <td>{f.name}</td>
                  <td className="num">{wholeKr(ne.fields[f.code].kr)}</td>
                </tr>
              ))}
              <tr className="bg-surface-2">
                <th colSpan={3} className="text-ink">Kostnader</th>
              </tr>
              {cost.map((f) => (
                <tr key={f.code}>
                  <td className="font-medium">{f.code}</td>
                  <td>{f.name}</td>
                  <td className="num">{wholeKr(ne.fields[f.code].kr)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td>R11</td>
                <td>Årets resultat (R1+R2+R3+R4−R5−R6−R7−R8−R9−R10). Överskott eller underskott</td>
                <td className="num">{wholeKr(ne.result)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-4 max-w-3xl space-y-2 text-[14px]">
        <p className={diff === 0 ? "text-success" : "text-warn"}>
          {diff === 0
            ? `Stämmer med bokfört resultat enligt kontona 3000–8989 (${wholeKr(ne.booked)}).`
            : `Avviker från bokfört resultat enligt kontona 3000–8799 (${wholeKr(ne.booked)}) med ${wholeKr(diff)}. ${
                ne.unmapped.length || ne.excluded.length ? "Orsaken är konton som saknar fält eller lämnats utanför." : "Orsaken kan vara avrundning till hela kronor."
              }`}
        </p>
        <p className="text-muted">
          Det här är ett underlag och inte en färdig deklaration. Kontrollera fälten mot NE-blanketten (SKV 2181) för inkomståret innan du lämnar in. Egenavgifter, schablonavdrag,
          periodiserings- och expansionsfond, räntefördelning och andra justeringar görs i själva deklarationen och ingår inte här. Bokfört resultat på konto 899x räknas inte med. Kopplingen följer BAS kopplingstabell för NE och kan ändras per konto.
        </p>
      </div>

      <Card title="Konton och kopplingar" className="mt-6">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Konto</th>
                <th>Namn</th>
                <th className="num">Belopp</th>
                <th className="no-print">Fält</th>
              </tr>
            </thead>
            <tbody>
              {ne.unmapped.length > 0 && (
                <>
                  <tr className="bg-warn-soft">
                    <th colSpan={4} className="text-warn">Saknar fält</th>
                  </tr>
                  {ne.unmapped.map((r) => (
                    <MappingRow key={r.number} row={r} fy={fy.id} readOnly={readOnly} />
                  ))}
                </>
              )}
              {NE_FIELDS.map((f) =>
                ne.fields[f.code].accounts.length ? (
                  <FieldGroup key={f.code} title={`${f.code} ${f.name}`} rows={ne.fields[f.code].accounts} fy={fy.id} readOnly={readOnly} />
                ) : null,
              )}
              {ne.excluded.length > 0 && <FieldGroup title="Lämnas utanför" rows={ne.excluded} fy={fy.id} readOnly={readOnly} />}
              {allRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-muted">Inga resultatkonton har saldo under räkenskapsåret.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function FieldGroup({ title, rows, fy, readOnly }: { title: string; rows: NeAccountRow[]; fy: number; readOnly: boolean }) {
  return (
    <>
      <tr className="bg-surface-2">
        <th colSpan={4} className="text-ink">{title}</th>
      </tr>
      {rows.map((r) => (
        <MappingRow key={r.number} row={r} fy={fy} readOnly={readOnly} />
      ))}
    </>
  );
}
