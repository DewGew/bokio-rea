import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";
import { hashPassword, verifyPassword } from "./password";

export { hashPassword, verifyPassword };

export const SESSION_COOKIE = "hb_session";
const SESSION_DAYS = 30;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function startSession(userId: number, activeCompanyId: number | null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.session.create({ data: { id: hashToken(token), userId, activeCompanyId, expiresAt } });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { id: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

/** Aktuell session (cachas per request). */
export const getSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { id: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  return session;
});

export async function requireUser() {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Inloggad användare + det aktiva företaget som användaren är medlem i. */
export const requireCompany = cache(async () => {
  const s = await requireUser();
  const memberships = await db.membership.findMany({
    where: { userId: s.userId },
    include: { company: true },
    orderBy: { companyId: "asc" },
  });
  if (memberships.length === 0) redirect("/companies/new");
  const active = memberships.find((m) => m.companyId === s.activeCompanyId) ?? memberships[0];
  if (active.companyId !== s.activeCompanyId) {
    await db.session.update({ where: { id: s.id }, data: { activeCompanyId: active.companyId } });
  }
  return {
    user: s.user,
    session: s,
    companyId: active.companyId,
    company: active.company,
    companies: memberships.map((m) => m.company),
  };
});

export async function setActiveCompany(sessionId: string, userId: number, companyId: number) {
  const m = await db.membership.findUnique({ where: { userId_companyId: { userId, companyId } } });
  if (!m) return false;
  await db.session.update({ where: { id: sessionId }, data: { activeCompanyId: companyId } });
  return true;
}

/** För API-routes: aktivt företag eller null (ingen redirect). */
export async function apiCompany() {
  const s = await getSession();
  if (!s?.activeCompanyId) return null;
  const m = await db.membership.findUnique({ where: { userId_companyId: { userId: s.userId, companyId: s.activeCompanyId } } });
  return m ? { userId: s.userId, companyId: m.companyId } : null;
}
