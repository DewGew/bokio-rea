import { apiCompany } from "@/lib/auth";
import { db } from "@/lib/db";
import { fyLabel } from "@/lib/fiscal";
import { underlagCounts, underlagEntries } from "@/lib/underlag-export";
import { ZIP_MAX_ENTRIES, zipStream } from "@/lib/zip-stream";

// Stora år kan ta lång tid. Sänk värdet om din Vercel-plan har en lägre gräns.
export const maxDuration = 300;

/** Underlag (kvitton, leverantörsfakturor m.m.) och fakturakopior för ett räkenskapsår som ZIP, med indexfil. */
export async function GET(req: Request) {
  const ctx = await apiCompany();
  if (!ctx) return new Response("Inte inloggad", { status: 401 });
  const fyId = Number(new URL(req.url).searchParams.get("fy"));
  const fy = await db.fiscalYear.findFirst({ where: { id: fyId || -1, companyId: ctx.companyId } });
  if (!fy) return new Response("Räkenskapsåret finns inte", { status: 404 });

  const counts = await underlagCounts(ctx.companyId, fy);
  if (counts.total > ZIP_MAX_ENTRIES) return new Response("För många filer för en export.", { status: 413 });

  const name = `Underlag-${fyLabel(fy)}.zip`.replace(/[^\w.\-åäöÅÄÖ]+/g, "_");
  return new Response(zipStream(underlagEntries(ctx.companyId, fy)), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
