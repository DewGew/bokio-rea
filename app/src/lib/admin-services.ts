import "server-only";
import { blobEnabled } from "./storage";

export type ServiceLink = { label: string; href: string };
export type Service = { name: string; used: string; status: { ok: boolean; text: string } | null; links: ServiceLink[] };

/** Externa tjänster som appen är kopplad till, med genvägar till deras egna adminsidor. */
export function externalServices(): Service[] {
  const onVercel = !!process.env.VERCEL;
  const model = process.env.OPENROUTER_MODEL || "google/gemini-3.1-flash-lite";
  return [
    {
      name: "Vercel",
      used: "Hosting, driftsättning, miljövariabler och loggar.",
      status: { ok: onVercel, text: onVercel ? `Körs på Vercel (${process.env.VERCEL_ENV ?? "okänd miljö"})` : "Körs inte på Vercel" },
      links: [
        { label: "Dashboard", href: "https://vercel.com/dashboard" },
        { label: "Driftstatus", href: "https://www.vercel-status.com" },
      ],
    },
    {
      name: "Vercel Blob",
      used: "Lagring av uppladdade underlag och logotyper.",
      status: { ok: blobEnabled() || !onVercel, text: blobEnabled() ? "Ansluten" : onVercel ? "Saknas" : "Lokal disk" },
      links: [{ label: "Öppna i Vercel (Storage)", href: "https://vercel.com/dashboard" }],
    },
    {
      name: "Neon (Postgres)",
      used: "Databasen: konton, företag och all bokföring.",
      status: { ok: !!process.env.DATABASE_URL, text: process.env.DATABASE_URL ? "Ansluten" : "DATABASE_URL saknas" },
      links: [{ label: "Neon Console", href: "https://console.neon.tech" }],
    },
    {
      name: "OpenRouter",
      used: "AI-avläsning av kvitton och leverantörsfakturor.",
      status: { ok: !!process.env.OPENROUTER_API_KEY, text: process.env.OPENROUTER_API_KEY ? `Nyckel satt, modell ${model}` : "Ingen nyckel, AI är inte aktiverad" },
      links: [
        { label: "Användning", href: "https://openrouter.ai/activity" },
        { label: "Krediter", href: "https://openrouter.ai/settings/credits" },
        { label: "API-nycklar", href: "https://openrouter.ai/keys" },
      ],
    },
    {
      name: "Postmark",
      used: "Mottagning av kvitton via e-post (Inbound).",
      status: { ok: !!process.env.INBOUND_ADDRESS && !!process.env.INBOUND_WEBHOOK_SECRET, text: process.env.INBOUND_ADDRESS && process.env.INBOUND_WEBHOOK_SECRET ? "Aktiverad" : "Inte aktiverad" },
      links: [
        { label: "Servrar", href: "https://account.postmarkapp.com/servers" },
        { label: "Driftstatus", href: "https://status.postmarkapp.com" },
      ],
    },
    {
      name: "GitHub",
      used: "Källkod och versionshantering.",
      status: null,
      links: [{ label: "Repository", href: "https://github.com/DewGew/bokio-rea" }],
    },
  ];
}
