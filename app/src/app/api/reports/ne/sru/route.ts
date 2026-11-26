import { apiCompany } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadNe } from "@/lib/ne-data";
import { SRU_BLANKETTER_FILE, SRU_INFO_FILE, SruError, buildBlanketterSru, buildInfoSru, toLatin1 } from "@/lib/sru";

/** NE-bilagan som SRU-filer för Skatteverkets filöverföring: ?file=info (INFO.SRU) eller ?file=blanketter (BLANKETTER.SRU). */
export async function GET(req: Request) {
  const ctx = await apiCompany();
  if (!ctx) return new Response("Inte inloggad", { status: 401 });
  const params = new URL(req.url).searchParams;
  const file = params.get("file");
  if (file !== "info" && file !== "blanketter") return new Response("Ange file=info eller file=blanketter.", { status: 400 });
  const fyId = Number(params.get("fy"));
  const [company, fy] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { name: true, orgNumber: true, address: true, postalCode: true, city: true, email: true, companyType: true } }),
    db.fiscalYear.findFirst({ where: { id: fyId || -1, companyId: ctx.companyId } }),
  ]);
  if (!fy) return new Response("Räkenskapsåret finns inte", { status: 404 });
  if (company.companyType !== "ef") return new Response("NE-bilagan gäller enskild firma.", { status: 400 });

  let text: string;
  try {
    const now = new Date();
    text = file === "info" ? buildInfoSru(company, now) : buildBlanketterSru(company, await loadNe(ctx.companyId, fy), fy, now);
  } catch (e) {
    if (e instanceof SruError) return new Response(e.message, { status: 400 });
    throw e;
  }
  return new Response(new Uint8Array(toLatin1(text)), {
    headers: {
      "Content-Type": "text/plain; charset=iso-8859-1",
      "Content-Disposition": `attachment; filename="${file === "info" ? SRU_INFO_FILE : SRU_BLANKETTER_FILE}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
