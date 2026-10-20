import { apiCompany } from "@/lib/auth";
import { db } from "@/lib/db";
import { fileResponse } from "@/lib/storage";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiCompany();
  if (!ctx) return new Response("Inte inloggad", { status: 401 });
  const { id } = await params;
  const upload = await db.upload.findFirst({ where: { id: Number(id) || -1, companyId: ctx.companyId } });
  if (!upload) return new Response("Hittades inte", { status: 404 });
  return fileResponse(upload, new URL(req.url).searchParams.has("download"));
}
