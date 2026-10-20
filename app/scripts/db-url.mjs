// Hittar databas-URL:en oavsett vilka namn integrationen gett miljövariablerna.
// Neon via Vercel: DATABASE_URL / DATABASE_URL_UNPOOLED, ibland med prefix (t.ex. STORAGE_DATABASE_URL).
// Vercel Postgres (äldre): POSTGRES_PRISMA_URL / POSTGRES_URL / POSTGRES_URL_NON_POOLING.

const POOLED = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL"];
const DIRECT = ["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"];

function findByName(env, names) {
  for (const n of names) if (env[n]) return n;
  // Varianter med prefix, t.ex. STORAGE_DATABASE_URL eller NEON_POSTGRES_URL_NON_POOLING.
  for (const n of names) {
    const hit = Object.keys(env).find((k) => k.endsWith(`_${n}`) && env[k]);
    if (hit) return hit;
  }
  return null;
}

/** Namnet på variabeln med anslutningen appen ska använda (poolad om möjligt). */
export function pooledName(env = process.env) {
  return findByName(env, POOLED) ?? findByName(env, DIRECT);
}

/** Namnet på variabeln för migreringar (direkt anslutning om möjligt). */
export function directName(env = process.env) {
  return findByName(env, DIRECT) ?? findByName(env, POOLED);
}

/** Namn (aldrig värden) på variabler som ser databasrelaterade ut, för felsökning. */
export function dbLikeNames(env = process.env) {
  return Object.keys(env).filter((k) => /DATABASE|POSTGRES|PG|NEON/i.test(k)).sort();
}
