import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { verifyPassword } from "./password";
import { logMfaFailure, verifyUserCode } from "./mfa";
import { companyBookkeeping, companyFiles, companyPurgeOps, deleteCompanyFiles } from "./company-delete";

export class AccountDeleteError extends Error {}

export type CompanyPlan = {
  companyId: number;
  name: string;
  role: string;
  /** leave: användaren lämnar företaget. delete: användaren är ensam medlem och företaget tas bort. blocked: måste ordnas först. */
  action: "leave" | "delete" | "blocked";
  reason?: string;
  /** Samma förklaring, riktad till en administratör. */
  adminReason?: string;
  missingYears?: { id: number; start: Date; end: Date }[];
  hasBookkeeping?: boolean;
};

/** Vad som händer med varje företag användaren är medlem i när kontot tas bort. */
export async function accountPlan(userId: number): Promise<CompanyPlan[]> {
  const memberships = await db.membership.findMany({
    where: { userId },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { companyId: "asc" },
  });
  const plans: CompanyPlan[] = [];
  for (const m of memberships) {
    const base = { companyId: m.companyId, name: m.company.name, role: m.role };
    const [members, owners] = await Promise.all([
      db.membership.count({ where: { companyId: m.companyId } }),
      db.membership.count({ where: { companyId: m.companyId, role: "owner" } }),
    ]);
    if (members === 1) {
      const b = await companyBookkeeping(m.companyId);
      if (b.blocked) {
        plans.push({ ...base, action: "blocked", missingYears: b.missingYears, hasBookkeeping: true, reason: "Du är ensam medlem och företaget har bokföring som inte är exporterad. Exportera en SIE-fil för varje räkenskapsår först.", adminReason: "ensam medlem och bokföringen är inte exporterad som SIE (användaren eller företagets ägare måste exportera den först)" });
      } else {
        plans.push({ ...base, action: "delete", hasBookkeeping: b.hasBookkeeping });
      }
    } else if (m.role === "owner" && owners === 1) {
      plans.push({ ...base, action: "blocked", reason: "Du är ensam ägare men företaget har fler användare. Utse en ny ägare (eller ta bort övriga användare) under Användare och behörighet först.", adminReason: "ensam ägare men företaget har fler användare (utse en ny ägare på företagets sida först)" });
    } else {
      plans.push({ ...base, action: "leave" });
    }
  }
  return plans;
}

/**
 * Tar bort användarens konto. Kräver lösenordet. Företag där användaren är ensam medlem och som saknar oexporterad
 * bokföring tas bort tillsammans med kontot. Övriga företag lämnas, men bara om de har en annan ägare.
 */
export async function deleteAccount(userId: number, password: string, code = "") {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new AccountDeleteError("Kontot finns inte.");
  if (user.lockedAt) throw new AccountDeleteError("Kontot är låst av en administratör och kan inte avslutas just nu. Kontakta administratören.");
  if (!password || !(await verifyPassword(password, user.passwordHash))) {
    throw new AccountDeleteError("Lösenordet stämmer inte. Inget har tagits bort.");
  }
  if (user.mfaEnabledAt && !(await verifyUserCode(userId, code))) {
    await logMfaFailure(userId);
    throw new AccountDeleteError("Koden från autentiseringsappen stämmer inte. Inget har tagits bort.");
  }
  const plans = await accountPlan(userId);
  const blocked = plans.filter((p) => p.action === "blocked");
  if (blocked.length) {
    throw new AccountDeleteError(`Kontot kan inte tas bort än: ${blocked.map((b) => `${b.name} – ${b.reason}`).join(" ")}`);
  }

  await removeUser(user, plans);
}

/**
 * Raderar användaren och de företag där hon är ensam medlem (planen måste vara godkänd, alltså utan blockerade företag).
 * `extraOps` körs i samma transaktion, till exempel en loggrad.
 */
export async function removeUser(user: { id: number; email: string }, plans: CompanyPlan[], extraOps: Prisma.PrismaPromise<unknown>[] = []) {
  const toDelete = plans.filter((p) => p.action === "delete");
  const files = await Promise.all(toDelete.map((p) => companyFiles(p.companyId)));

  await db.$transaction([
    ...toDelete.flatMap((p) => companyPurgeOps(p.companyId)),
    // Engångskoder och obesvarade inbjudningar till adressen saknar koppling till användaren och städas bort här.
    db.oAuthCode.deleteMany({ where: { userId: user.id } }),
    db.invitation.deleteMany({ where: { email: user.email.toLowerCase(), acceptedAt: null } }),
    ...extraOps,
    // Sessioner, medlemskap och kopplingar (OAuth) raderas via kaskad.
    db.user.delete({ where: { id: user.id } }),
  ]);
  for (const f of files) if (f) await deleteCompanyFiles(f);
}
