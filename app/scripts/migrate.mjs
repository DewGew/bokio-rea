// Kör `prisma migrate deploy` vid bygget på Vercel, mot en direkt anslutning om en sådan finns.
import { spawnSync } from "node:child_process";
import { dbLikeNames, directName } from "./db-url.mjs";

const name = directName();

if (!name) {
  const seen = dbLikeNames();
  console.error(
    "\n✖ Ingen databas-URL hittades. Koppla en Postgres-databas (t.ex. Neon) till projektet under Storage i Vercel\n" +
      "  för den här miljön (Production/Preview), eller sätt DATABASE_URL, och gör sedan Redeploy.\n" +
      (seen.length ? `  Databasliknande variabler som finns: ${seen.join(", ")}\n` : "  Inga databasliknande variabler finns i bygget.\n"),
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
