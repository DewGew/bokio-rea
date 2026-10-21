import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { hashToken } from "./token";
import { AccountingError } from "./accounting";
import { isRole, type Role } from "./session-config";

/** Fel som visas för användaren (samma hantering som bokföringsfel). */
export class MemberError extends AccountingError {}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_DAYS = 14;

/** Skapar en inbjudan och returnerar token till länken (sparas bara som hash, så den kan inte visas igen). */
export async function createInvitation(companyId: number, invitedById: number, emailInput: string, role: string) {
  const email = emailInput.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new MemberError("Ange en giltig e-postadress.");
  if (role !== "full" && role !== "read") throw new MemberError("Välj en behörighet.");
  const member = await db.membership.findFirst({ where: { companyId, user: { email } } });
  if (member) throw new MemberError(`${email} har redan tillgång till företaget.`);

  const token = randomBytes(24).toString("base64url");
  await db.$transaction([
    // En ny inbjudan ersätter en tidigare obesvarad till samma adress.
    db.invitation.deleteMany({ where: { companyId, email, acceptedAt: null } }),
    db.invitation.create({
      data: { companyId, email, role, invitedById, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) },
    }),
  ]);
  return token;
}

/** Giltig (obesvarad, ej utgången) inbjudan för en token, eller null. */
export async function findInvitation(token: string) {
  if (!token || token.length > 100) return null;
  const inv = await db.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { company: { select: { id: true, name: true } } } });
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) return null;
  const inviter = inv.invitedById ? await db.user.findUnique({ where: { id: inv.invitedById }, select: { name: true } }) : null;
  return { ...inv, inviterName: inviter?.name ?? null };
}

/** Användaren går med i företaget. Inbjudan gäller bara den e-postadress den skickades till. */
export async function acceptInvitation(token: string, user: { id: number; email: string }) {
  return db.$transaction(async (t) => {
    const inv = await t.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) throw new MemberError("Inbjudan är ogiltig eller har gått ut. Be om en ny.");
    if (inv.email !== user.email.toLowerCase()) throw new MemberError(`Inbjudan gäller ${inv.email}. Logga in med det kontot.`);
    const existing = await t.membership.findUnique({ where: { userId_companyId: { userId: user.id, companyId: inv.companyId } } });
    if (!existing) await t.membership.create({ data: { userId: user.id, companyId: inv.companyId, role: inv.role } });
    await t.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    return inv.companyId;
  });
}

async function assertOwnerRemains(companyId: number, userId: number, newRole: Role | null) {
  if (newRole === "owner") return;
  const m = await db.membership.findUnique({ where: { userId_companyId: { userId, companyId } } });
  if (!m) throw new MemberError("Användaren finns inte i företaget.");
  if (m.role !== "owner") return;
  const owners = await db.membership.count({ where: { companyId, role: "owner" } });
  if (owners <= 1) throw new MemberError("Företaget måste ha minst en ägare.");
}

export async function setMemberRole(companyId: number, userId: number, role: string) {
  if (!isRole(role)) throw new MemberError("Ogiltig behörighet.");
  await assertOwnerRemains(companyId, userId, role);
  await db.membership.update({ where: { userId_companyId: { userId, companyId } }, data: { role } });
}

export async function removeMember(companyId: number, userId: number) {
  await assertOwnerRemains(companyId, userId, null);
  await db.membership.delete({ where: { userId_companyId: { userId, companyId } } });
}
