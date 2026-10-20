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
