import "server-only";
import { notFound } from "next/navigation";
import { db } from "./db";
import { requireUser } from "./auth";

/** E-postadresser (kommaseparerade) i ADMIN_EMAILS har tillgång till /admin. */
export function isAdminEmail(email: string) {
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

/** Kräver inloggad administratör. Andra användare får 404, så att sidan inte avslöjas. */
export async function requireAdmin() {
  const s = await requireUser();
  if (!isAdminEmail(s.user.email)) notFound();
  return s;
}

/** Skriver en rad i administratörsloggen. Allt administratörer gör ska passera här. */
export function adminLogOp(entry: { adminEmail: string; action: string; targetType: "user" | "company"; targetId?: number; targetLabel?: string; details?: string }) {
  return db.adminLog.create({
    data: { adminEmail: entry.adminEmail, action: entry.action, targetType: entry.targetType, targetId: entry.targetId ?? null, targetLabel: entry.targetLabel ?? "", details: entry.details ?? "" },
  });
}

export const ADMIN_ACTIONS: Record<string, string> = {
  user_locked: "Låste användare",
  user_unlocked: "Låste upp användare",
  user_disabled: "Spärrade användare (äldre)",
  user_enabled: "Återaktiverade användare (äldre)",
  user_sessions_ended: "Loggade ut användare överallt",
  password_reset_link: "Skapade återställningslänk",
  company_owner_added: "Utsåg ny ägare",
  company_locked: "Låste företag",
  company_unlocked: "Låste upp företag",
  company_deleted: "Raderade företag",
  grant_revoked: "Återkallade koppling",
  orphans_deleted: "Rensade föräldralösa filer",
};

export const dateTime = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "short", timeStyle: "short" });
