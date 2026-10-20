// Kör `prisma migrate deploy` vid bygget på Vercel.
// Migreringar bör gå via en direkt (opoolad) anslutning, men namnet på den variabeln skiljer sig
// mellan integrationer (Neon: DATABASE_URL_UNPOOLED, Vercel Postgres: POSTGRES_URL_NON_POOLING).
// Vi tar den första som finns och faller annars tillbaka på DATABASE_URL.
import { spawnSync } from "node:child_process";

const candidates = ["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL"];
const name = candidates.find((n) => process.env[n]);

if (!name) {
  console.error(
    "\n✖ Ingen databas-URL hittades. Koppla en Postgres-databas (t.ex. Neon) till projektet under Storage i Vercel,\n" +
      "  eller sätt miljövariabeln DATABASE_URL, och deploya igen.\n",
  );
  process.exit(1);
}

console.log(`Kör migreringar mot databasen från ${name}.`);
const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, DATABASE_URL: process.env[name] },
});
process.exit(result.status ?? 1);
