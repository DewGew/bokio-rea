import { apiCompany } from "@/lib/auth";
import { exportSie } from "@/lib/sie-export";

export async function GET(req: Request) {
  const ctx = await apiCompany();
  if (!ctx) return new Response("Inte inloggad", { status: 401 });
  const fy = Number(new URL(req.url).searchParams.get("fy"));
  const file = await exportSie(ctx.companyId, fy);
  if (!file) return new Response("Räkenskapsåret finns inte", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
