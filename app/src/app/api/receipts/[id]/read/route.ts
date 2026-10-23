import { NextResponse } from "next/server";
import { READ_ONLY_MESSAGE, apiCompany } from "@/lib/auth";
import { db } from "@/lib/db";
import { readUpload } from "@/lib/receipt-read";
import type { ReceiptData } from "@/lib/receipt-ai";

export const maxDuration = 60;

/** Läser av ett uppladdat underlag med AI (?force=1 läser om). Logiken finns i readUpload (src/lib/receipt-read.ts). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiCompany();
  if (!ctx) return NextResponse.json({ error: "Inte inloggad." }, { status: 401 });
  const { id } = await params;
  const force = new URL(req.url).searchParams.has("force");
  if (ctx.role === "read") {
    // Läsbehörighet: en sparad avläsning kan visas, men ingen ny görs.
    const u = await db.upload.findFirst({ where: { id: Number(id) || -1, companyId: ctx.companyId } });
    if (!u) return NextResponse.json({ error: "Underlaget finns inte." }, { status: 404 });
    if (u.aiStatus === "done" && u.aiData && !force) return NextResponse.json({ status: "done", data: u.aiData as ReceiptData });
    return NextResponse.json({ status: "error", error: READ_ONLY_MESSAGE }, { status: 403 });
  }
  const result = await readUpload(ctx.companyId, Number(id) || -1, { force });
  if (result.status === "error" && result.notFound) return NextResponse.json({ status: "error", error: result.error }, { status: 404 });
  return NextResponse.json(result);
}
