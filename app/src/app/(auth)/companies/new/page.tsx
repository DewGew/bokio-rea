import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ActionForm } from "@/components/ActionForm";
import { CompanyFields } from "@/components/CompanyFields";
import { addCompany, logout } from "../../actions";

export default async function NewCompany() {
  const s = await requireUser();
  const count = await db.membership.count({ where: { userId: s.userId } });
  return (
    <>
      <h1 className="mb-1 text-center text-[28px] font-semibold tracking-[-0.02em]">Lägg till företag</h1>
      <p className="mb-7 text-center text-[15px] text-muted">
        Varje företag får en egen bokföring, kontoplan och egna fakturor.
        {count > 0 && (
          <>
            {" "}
            <Link href="/" className="text-brand">Tillbaka</Link>
          </>
        )}
      </p>
      <p className="mb-5 rounded-xl bg-brand-soft px-3 py-2 text-center text-[13px] text-brand">
        Nya företag börjar med <strong>Bas</strong>. AI-avläsning, koppling till AI-assistent och kvitton via e-post ingår i Pro.
      </p>
      <ActionForm action={addCompany} submit="Skapa företag">
        <CompanyFields />
      </ActionForm>
      {count === 0 && (
        <form action={logout} className="mt-4 text-center">
          <button className="text-sm text-muted underline">Logga ut</button>
        </form>
      )}
    </>
  );
}
