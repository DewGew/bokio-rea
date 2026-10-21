import Link from "next/link";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { findInvitation } from "@/lib/members";
import { ROLES, type Role } from "@/lib/session-config";
import { Flash, readParams, type SP } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { acceptInvite, logout } from "../../actions";

export default async function Invite({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SP }) {
  const { token } = await params;
  const { error } = await readParams(searchParams);
  const inv = await findInvitation(token);

  if (!inv) {
    return (
      <>
        <h1 className="mb-2 text-center text-[24px] font-semibold tracking-[-0.02em]">Inbjudan gäller inte längre</h1>
        <p className="mb-6 text-center text-[15px] text-muted">Länken är redan använd, återkallad eller har gått ut. Be den som bjöd in dig om en ny.</p>
        <Link href="/login" className="btn-secondary w-full">Till inloggningen</Link>
      </>
    );
  }

  const session = await getSession();
  const role = ROLES[inv.role as Role] ?? ROLES.read;
  const hasAccount = !session && (await db.user.findUnique({ where: { email: inv.email }, select: { id: true } })) !== null;

  return (
    <>
      <h1 className="mb-2 text-center text-[24px] font-semibold tracking-[-0.02em]">Inbjudan till {inv.company.name}</h1>
      <p className="mb-6 text-center text-[15px] text-muted">
        {inv.inviterName ? `${inv.inviterName} har bjudit in dig` : "Du är inbjuden"} med <strong className="text-ink">{role.label.toLowerCase()}</strong>.{" "}
        {role.hint}
      </p>
      <Flash error={error} />

      {session ? (
        session.user.email === inv.email ? (
          <form action={acceptInvite}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="mode" value="join" />
            <ConfirmButton className="btn-primary w-full">Gå med i {inv.company.name}</ConfirmButton>
          </form>
        ) : (
          <div className="space-y-4 text-center text-[15px]">
            <p>
              Inbjudan gäller <strong>{inv.email}</strong>, men du är inloggad som {session.user.email}.
            </p>
            <form action={logout}>
              <button className="btn-secondary w-full">Logga ut och försök igen</button>
            </form>
          </div>
        )
      ) : (
        <form action={acceptInvite} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="mode" value={hasAccount ? "login" : "register"} />
          <div>
            <label className="label" htmlFor="email">E-post</label>
            <input id="email" value={inv.email} readOnly className="input opacity-70" />
          </div>
          {!hasAccount && (
            <div>
              <label className="label" htmlFor="name">Ditt namn</label>
              <input id="name" name="name" autoComplete="name" required className="input" />
            </div>
          )}
          <div>
            <label className="label" htmlFor="password">{hasAccount ? "Lösenord" : "Välj lösenord (minst 10 tecken)"}</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={hasAccount ? "current-password" : "new-password"}
              minLength={hasAccount ? undefined : 10}
              required
              className="input"
            />
          </div>
          <ConfirmButton className="btn-primary w-full">{hasAccount ? "Logga in och gå med" : "Skapa konto och gå med"}</ConfirmButton>
        </form>
      )}
    </>
  );
}
