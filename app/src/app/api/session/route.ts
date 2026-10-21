import { getSession } from "@/lib/auth";

/** Håller sessionen vid liv medan användaren är aktiv i webbläsaren (anropas av IdleLogout). */
export async function POST() {
  const s = await getSession();
  return new Response(null, { status: s ? 204 : 401 });
}
