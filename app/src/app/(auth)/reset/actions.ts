"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { withParam } from "@/lib/action";
import { hashToken } from "@/lib/token";

export async function resetPassword(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  const password = String(fd.get("password") ?? "");
  const again = String(fd.get("password2") ?? "");
  const back = (msg: string): never => redirect(withParam(`/reset/${token}`, "error", msg));

  const reset = token && token.length < 100 ? await db.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } }) : null;
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) back("Länken är ogiltig eller har gått ut. Be administratören om en ny.");
  if (password.length < 10) back("Lösenordet måste vara minst 10 tecken.");
  if (password !== again) back("Lösenorden är inte lika.");

  await db.$transaction([
    db.user.update({ where: { id: reset!.userId }, data: { passwordHash: await hashPassword(password) } }),
    db.passwordReset.update({ where: { id: reset!.id }, data: { usedAt: new Date() } }),
    db.passwordReset.deleteMany({ where: { userId: reset!.userId, usedAt: null } }),
    // Alla gamla sessioner avslutas, så att den som hade tillgång innan inte kommer vidare.
    db.session.deleteMany({ where: { userId: reset!.userId } }),
  ]);
  redirect(withParam("/login", "ok", "Lösenordet är bytt. Logga in med det nya."));
}
