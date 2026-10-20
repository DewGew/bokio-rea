export function CompanyFields() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="companyName">Företagsnamn *</label>
        <input id="companyName" name="companyName" required className="input" placeholder="Mitt Företag AB" />
      </div>
      <div>
        <label className="label" htmlFor="orgNumber">Organisationsnummer *</label>
        <input id="orgNumber" name="orgNumber" required className="input" placeholder="556677-8899" inputMode="numeric" />
      </div>
      <div>
        <label className="label" htmlFor="vatNumber">Momsreg.nr</label>
        <input id="vatNumber" name="vatNumber" className="input" placeholder="SE556677889901" />
      </div>
      <div>
        <label className="label" htmlFor="companyType">Företagsform</label>
        <select id="companyType" name="companyType" defaultValue="ab" className="input">
          <option value="ab">Aktiebolag</option>
          <option value="ef">Enskild firma</option>
          <option value="hb">Handelsbolag / kommanditbolag</option>
          <option value="ek">Ekonomisk förening</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="vatPeriod">Momsredovisning</label>
        <select id="vatPeriod" name="vatPeriod" defaultValue="quarter" className="input">
          <option value="month">Varje månad</option>
          <option value="quarter">Varje kvartal</option>
          <option value="year">En gång per år</option>
          <option value="none">Ej momsregistrerad</option>
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="fiscalStartMonth">Räkenskapsåret börjar</label>
        <select id="fiscalStartMonth" name="fiscalStartMonth" defaultValue="1" className="input">
          {["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"].map((m, i) => (
            <option key={m} value={i + 1}>
              1 {m}
              {i === 0 ? " (kalenderår)" : ""}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[12px] text-muted">Förlängt eller förkortat första år ställer du in efteråt under Inställningar.</p>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="address">Adress</label>
        <input id="address" name="address" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="postalCode">Postnummer</label>
        <input id="postalCode" name="postalCode" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="city">Ort</label>
        <input id="city" name="city" className="input" />
      </div>
    </div>
  );
}
