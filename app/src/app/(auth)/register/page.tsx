import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ActionForm } from "@/components/ActionForm";
import { CompanyFields } from "@/components/CompanyFields";
import { register } from "../actions";

export default async function Register() {
  if (await getSession()) redirect("/companies/new");
  return (
    <>
      <h1 className="mb-1 text-center text-[28px] font-semibold tracking-[-0.02em]">Registrera företag</h1>
      <p className="mb-7 text-center text-[15px] text-muted">
        Har du redan ett konto? <Link href="/login" className="text-brand">Logga in</Link>
      </p>
      <p className="mb-5 rounded-xl bg-brand-soft px-3 py-2 text-center text-[13px] text-brand">
        Nya företag börjar med <strong>Gratis</strong>. AI-avläsning, koppling till Claude och kvitton via e-post ingår i Pro.
      </p>
      <ActionForm action={register} submit="Skapa konto och företag">
        <fieldset className="space-y-3">
          <legend className="mb-3 text-[15px] font-semibold">Ditt konto</legend>
          <div>
            <label className="label" htmlFor="name">Namn *</label>
            <input id="name" name="name" autoComplete="name" required className="input" />
          </div>
          <div>
            <label className="label" htmlFor="email">E-post *</label>
            <input id="email" name="email" type="email" autoComplete="email" required className="input" />
          </div>
          <div>
            <label className="label" htmlFor="password">Lösenord * (minst 10 tecken)</label>
            <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required className="input" />
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-3 text-[15px] font-semibold">Företaget</legend>
          <CompanyFields />
        </fieldset>
      </ActionForm>
    </>
  );
}
