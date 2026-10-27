import Link from "next/link";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/token";
import { Flash, readParams, type SP } from "@/components/ui";
import { resetPassword } from "../actions";

export default async function Reset({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SP }) {
  const { token } = await params;
  const { error } = await readParams(searchParams);
  const reset = token.length < 100 ? await db.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } }) : null;
  const valid = !!reset && !reset.usedAt && reset.expiresAt > new Date();

  if (!valid) {
    return (
      <>
        <h1 className="mb-2 text-center text-[24px] font-semibold tracking-[-0.02em]">Länken gäller inte längre</h1>
        <p className="mb-6 text-center text-[15px] text-muted">Länken är redan använd eller har gått ut. Be administratören om en ny.</p>
        <Link href="/login" className="btn-secondary w-full">Till inloggningen</Link>
      </>
    );
  }
  return (
    <>
      <h1 className="mb-2 text-center text-[24px] font-semibold tracking-[-0.02em]">Välj nytt lösenord</h1>
      <p className="mb-6 text-center text-[15px] text-muted">Minst 10 tecken. Du loggas ut på alla enheter när lösenordet är bytt.</p>
      <Flash error={error} />
      <form action={resetPassword} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <div>
          <label className="label" htmlFor="password">Nytt lösenord</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="password2">Upprepa lösenordet</label>
          <input id="password2" name="password2" type="password" autoComplete="new-password" minLength={10} required className="input" />
        </div>
        <button className="btn-primary w-full">Byt lösenord</button>
      </form>
    </>
  );
}
