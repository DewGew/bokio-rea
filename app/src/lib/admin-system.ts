import "server-only";
import { db } from "./db";
import { blobEnabled, directUploadEnabled, listStoredFiles } from "./storage";

const DAY = 86_400_000;

export async function databaseStatus() {
  const t0 = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    const ms = Date.now() - t0;
    const rows = await db
      .$queryRaw<{ migration_name: string; finished_at: Date }[]>`SELECT migration_name, finished_at FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`
      .catch(() => []);
    const pending = await db
      .$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`
      .then((r) => Number(r[0]?.n ?? 0))
      .catch(() => null);
    return { ok: true, ms, lastMigration: rows[0]?.migration_name ?? null, lastMigrationAt: rows[0]?.finished_at ?? null, failedMigrations: pending };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, lastMigration: null, lastMigrationAt: null, failedMigrations: null, error: (e as Error).message.slice(0, 200) };
  }
}

/** Vilka inställningar som är satta. Värdena visas aldrig, bara om de finns. */
export function configStatus() {
  const set = (v: string | undefined) => !!v;
  return [
    { name: "Fillagring (Vercel Blob)", ok: blobEnabled() || !process.env.VERCEL, note: blobEnabled() ? (directUploadEnabled() ? "Token, direktuppladdning" : "OIDC, uppladdning via servern (max 4,3 MB)") : process.env.VERCEL ? "Saknas" : "Lokal disk" },
    { name: "Inkommande e-post (INBOUND_WEBHOOK_SECRET)", ok: set(process.env.INBOUND_WEBHOOK_SECRET), note: set(process.env.INBOUND_WEBHOOK_SECRET) ? "Aktiverad" : "Inte aktiverad" },
    { name: "Kvittoadress (INBOUND_ADDRESS)", ok: set(process.env.INBOUND_ADDRESS), note: set(process.env.INBOUND_ADDRESS) ? "Satt" : "Saknas" },
    { name: "AI-avläsning (OPENROUTER_API_KEY)", ok: set(process.env.OPENROUTER_API_KEY), note: set(process.env.OPENROUTER_API_KEY) ? "Nyckel satt" : "Inte aktiverad" },
    { name: "Appens webbadress (APP_URL)", ok: set(process.env.APP_URL), note: set(process.env.APP_URL) ? "Satt" : "Saknas" },
    { name: "Administratörer (ADMIN_EMAILS)", ok: set(process.env.ADMIN_EMAILS), note: `${(process.env.ADMIN_EMAILS ?? "").split(",").filter((s) => s.trim()).length} adresser` },
  ];
}

export async function activitySummary() {
  const [lastInbound, lastAi, activeSessions] = await Promise.all([
    db.inboundEmail.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true, status: true } }),
    db.upload.findFirst({ where: { aiStatus: "done" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.session.count({ where: { expiresAt: { gt: new Date() } } }),
  ]);
  return { lastInbound, lastAi, activeSessions };
}

export type DayRow = { day: string; login: number; inbound: number; storage: number; ai: number };

/** Fel per dag de senaste 14 dagarna, samt de senaste felen. Rensar också händelser äldre än 30 dagar. */
export async function errorOverview() {
  await db.systemEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * DAY) } } });
  const since = new Date(Date.now() - 14 * DAY);
  const [events, inbound, ai, latestEvents, latestInbound, latestAi] = await Promise.all([
    db.systemEvent.findMany({ where: { createdAt: { gte: since } }, select: { kind: true, createdAt: true }, take: 20000 }),
    db.inboundEmail.findMany({ where: { createdAt: { gte: since }, status: "error" }, select: { createdAt: true }, take: 20000 }),
    db.upload.findMany({ where: { createdAt: { gte: since }, aiStatus: "error" }, select: { createdAt: true }, take: 20000 }),
    db.systemEvent.findMany({ orderBy: { id: "desc" }, take: 25 }),
    db.inboundEmail.findMany({ where: { status: "error" }, orderBy: { id: "desc" }, take: 15, select: { createdAt: true, detail: true, company: { select: { name: true } } } }),
    db.upload.findMany({ where: { aiStatus: "error" }, orderBy: { id: "desc" }, take: 15, select: { createdAt: true, aiError: true, company: { select: { name: true } } } }),
  ]);
  const key = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  const days = new Map<string, DayRow>();
  for (let i = 0; i < 14; i++) {
    const day = key(new Date(Date.now() - i * DAY));
    days.set(day, { day, login: 0, inbound: 0, storage: 0, ai: 0 });
  }
  for (const e of events) {
    const r = days.get(key(e.createdAt));
    if (!r) continue;
    if (e.kind === "login_failed") r.login++;
    else if (e.kind === "inbound_storage_error") r.storage++;
  }
  for (const e of inbound) days.get(key(e.createdAt)) && (days.get(key(e.createdAt))!.inbound += 1);
  for (const e of ai) days.get(key(e.createdAt)) && (days.get(key(e.createdAt))!.ai += 1);
  return { days: [...days.values()], latestEvents, latestInbound, latestAi };
}

/** Filer i lagringen som saknas i databasen och är äldre än ett dygn (nyare kan vara under uppladdning). */
export async function findOrphans() {
  const [files, uploads, logos] = await Promise.all([
    listStoredFiles(),
    db.upload.findMany({ select: { storedName: true } }),
    db.company.findMany({ where: { logoStoredName: { not: null } }, select: { logoStoredName: true } }),
  ]);
  const known = new Set<string>([...uploads.map((u) => u.storedName), ...logos.map((l) => l.logoStoredName!)]);
  const cutoff = Date.now() - DAY;
  const orphans = files.filter((f) => !known.has(f.pathname) && f.uploadedAt.getTime() < cutoff);
  return { total: files.length, totalSize: files.reduce((n, f) => n + f.size, 0), orphans };
}
