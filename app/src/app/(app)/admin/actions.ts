"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { adminLogOp, isAdminEmail, requireAdmin } from "@/lib/admin";
import { str, withParam } from "@/lib/action";
import { hashToken } from "@/lib/token";

const back = (key: "ok" | "error", msg: string): never => redirect(withParam("/admin", key, msg));

async function target(fd: FormData) {
  const admin = await requireAdmin();
  const user = await db.user.findUnique({ where: { id: Number(str(fd, "userId")) || -1 } });
  if (!user) back("error", "Användaren finns inte.");
  return { adminEmail: admin.user.email, user: user! };
}

export async function disableUser(fd: FormData) {
  const { adminEmail, user } = await target(fd);
  if (isAdminEmail(user.email)) back("error", "Administratörer kan inte spärras.");
  if (user.disabledAt) back("error", `${user.email} är redan spärrad.`);
  const reason = str(fd, "reason").slice(0, 200);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } }),
    db.session.deleteMany({ where: { userId: user.id } }),
    adminLogOp({ adminEmail, action: "user_disabled", targetType: "user", targetId: user.id, targetLabel: user.email, details: reason }),
  ]);
  revalidatePath("/admin");
  back("ok", `${user.email} är spärrad och utloggad.`);
}

export async function enableUser(fd: FormData) {
  const { adminEmail, user } = await target(fd);
  if (!user.disabledAt) back("error", `${user.email} är inte spärrad.`);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { disabledAt: null } }),
    adminLogOp({ adminEmail, action: "user_enabled", targetType: "user", targetId: user.id, targetLabel: user.email }),
  ]);
  revalidatePath("/admin");
  back("ok", `${user.email} är återaktiverad.`);
}

export async function endUserSessions(fd: FormData) {
  const { adminEmail, user } = await target(fd);
  const { count } = await db.session.deleteMany({ where: { userId: user.id } });
  await adminLogOp({ adminEmail, action: "user_sessions_ended", targetType: "user", targetId: user.id, targetLabel: user.email, details: `${count} sessioner avslutade` });
  revalidatePath("/admin");
  back("ok", `${user.email} är utloggad på alla enheter (${count} sessioner).`);
}

export type ResetState = { link?: string; error?: string; email?: string } | undefined;

/** Skapar en engångslänk (giltig i 24 timmar) som administratören ger användaren. Länken visas bara en gång. */
export async function createResetLink(_: ResetState, fd: FormData): Promise<ResetState> {
  const admin = await requireAdmin();
  const user = await db.user.findUnique({ where: { id: Number(str(fd, "userId")) || -1 } });
  if (!user) return { error: "Användaren finns inte." };
  const token = randomBytes(24).toString("base64url");
  await db.$transaction([
    db.passwordReset.deleteMany({ where: { userId: user.id, usedAt: null } }),
    db.passwordReset.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 24 * 3_600_000) } }),
    adminLogOp({ adminEmail: admin.user.email, action: "password_reset_link", targetType: "user", targetId: user.id, targetLabel: user.email, details: "Giltig i 24 timmar" }),
  ]);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return { link: `${proto}://${host}/reset/${token}`, email: user.email };
}
