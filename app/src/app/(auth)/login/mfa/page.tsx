import Link from "next/link";
import { redirect } from "next/navigation";
import { readChallenge } from "@/lib/mfa";
import { Flash, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { verifyMfaLogin } from "../../actions";

export default async function LoginMfa({ searchParams }: { searchParams: SP }) {
  const { error } = await readParams(searchParams);
  if (!(await readChallenge())) redirect("/login");
  return (
    <>
      <h1 className="mb-2 text-center text-[24px] font-semibold tracking-[-0.02em]">Tvåfaktorsinloggning</h1>
      <p className="mb-6 text-center text-[15px] text-muted">Ange den sexsiffriga koden från din autentiseringsapp. Har du tappat telefonen kan du använda en återställningskod.</p>
      <Flash error={error} />
      <form action={verifyMfaLogin} className="space-y-4">
        <div>
          <label className="label" htmlFor="code">Kod</label>
          <input id="code" name="code" inputMode="text" autoComplete="one-time-code" autoFocus required maxLength={12} className="input text-center text-[20px] tracking-[0.2em]" />
        </div>
        <ConfirmButton className="btn-primary w-full">Bekräfta</ConfirmButton>
      </form>
      <p className="mt-4 text-center text-[14px]">
        <Link href="/login" className="text-brand">Tillbaka till inloggningen</Link>
      </p>
    </>
  );
}
