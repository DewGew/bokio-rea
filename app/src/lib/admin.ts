import "server-only";
import { notFound } from "next/navigation";
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
