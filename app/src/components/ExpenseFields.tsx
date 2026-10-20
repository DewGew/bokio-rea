export function ExpenseFields({ accounts }: { accounts: { number: number; name: string }[] }) {
  return (
    <>
      <div>
        <label className="label" htmlFor="employee">Vem betalade?</label>
        <input id="employee" name="employee" required className="input" placeholder="Namn" />
      </div>
      <div>
        <label className="label" htmlFor="edate">Datum</label>
        <input id="edate" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="input" />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="edesc">Beskrivning</label>
        <input id="edesc" name="description" required className="input" placeholder="T.ex. Taxi till kundmöte" />
      </div>
      <div>
        <label className="label" htmlFor="eamount">Belopp inkl. moms</label>
        <input id="eamount" name="amount" required inputMode="decimal" className="input text-right" placeholder="0,00" />
      </div>
      <div>
        <label className="label" htmlFor="evat">Moms</label>
        <select id="evat" name="vatRate" defaultValue="25" className="input">
          <option value="25">25 %</option>
          <option value="12">12 %</option>
          <option value="6">6 %</option>
          <option value="0">0 %</option>
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="ecost">Kostnadskonto</label>
        <select id="ecost" name="costAccount" defaultValue="6991" className="input">
          {accounts
            .filter((a) => a.number >= 4000 && a.number < 8000)
            .map((a) => (
              <option key={a.number} value={a.number}>
                {a.number} {a.name}
              </option>
            ))}
        </select>
      </div>
    </>
  );
}
