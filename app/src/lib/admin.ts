import "server-only";
import { notFound, redirect } from "next/navigation";
import { mfaAvailable } from "./mfa";
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
  // Administratörer måste ha tvåfaktorsinloggning. Är den inte konfigurerad på servern kan ingen aktivera den, så då släpps de in (System-fliken varnar).
  if (mfaAvailable() && !s.user.mfaEnabledAt) redirect("/settings/account/mfa?required=1");
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
  user_mfa_reset: "Återställde tvåfaktor",
  company_owner_added: "Utsåg ny ägare",
  company_locked: "Låste företag",
  company_unlocked: "Låste upp företag",
  company_deleted: "Raderade företag",
  company_plan: "Ändrade abonnemang",
  feature_switch: "Slog av/på funktion",
  grant_revoked: "Återkallade koppling",
  orphans_deleted: "Rensade föräldralösa filer",
};

export const dateTime = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "short", timeStyle: "short" });
