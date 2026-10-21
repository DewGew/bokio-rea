import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { READ_ONLY_MESSAGE, apiCompany } from "@/lib/auth";
import { db } from "@/lib/db";
import { readStored } from "@/lib/storage";
import { AI_VERSION, ReceiptAiError, aiEnabled, readReceipt, type ReceiptData } from "@/lib/receipt-ai";

export const maxDuration = 60;

const READABLE = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

/**
 * Läser av ett uppladdat underlag med AI. Resultatet sparas, så samma kvitto läses bara en gång
 * (?force=1 läser om). Fyller även i belopp, datum och beskrivning på underlaget om de saknas.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiCompany();
  if (!ctx) return NextResponse.json({ error: "Inte inloggad." }, { status: 401 });
  const { id } = await params;
  const upload = await db.upload.findFirst({ where: { id: Number(id) || -1, companyId: ctx.companyId } });
  if (!upload) return NextResponse.json({ error: "Underlaget finns inte." }, { status: 404 });

  const force = new URL(req.url).searchParams.has("force");
  const cached = upload.aiData as ReceiptData | null;
  // Äldre avläsningar (före AI_VERSION) görs om, så att de får en mall.
  const outdated = !!cached && (cached.version ?? 1) < AI_VERSION;
  if (upload.aiStatus === "done" && cached && !force && !outdated) return NextResponse.json({ status: "done", data: cached });
  if (ctx.role === "read") return NextResponse.json({ status: "error", error: READ_ONLY_MESSAGE }, { status: 403 });
  if (!aiEnabled()) return NextResponse.json({ status: "disabled" });
  if (!READABLE.includes(upload.mimeType)) return NextResponse.json({ status: "error", error: "Filtypen kan inte läsas av." });

  const bytes = await readStored(upload);
  if (!bytes) return NextResponse.json({ status: "error", error: "Filen kunde inte läsas." }, { status: 404 });
  // Underlag är inköp: försäljningsmallar ska aldrig föreslås.
  const templates = await db.template.findMany({ where: { companyId: ctx.companyId, direction: { not: "sale" } }, select: { id: true, name: true, description: true } });

  try {
    const data: ReceiptData = await readReceipt({ bytes, mime: upload.mimeType, name: upload.fileName }, templates);
    const date = data.date ? new Date(`${data.date}T00:00:00Z`) : null;
    await db.upload.update({
      where: { id: upload.id },
      data: {
        aiStatus: "done",
        aiData: data as unknown as Prisma.InputJsonValue,
        aiError: null,
        // Belopp sparas bara i kronor; utländsk valuta får räknas om manuellt.
        amount: upload.amount ?? (data.total && data.currency === "SEK" ? Math.round(data.total * 100) : null),
        date: upload.date ?? date,
        description: (force || outdated ? "" : upload.description) || [data.supplier, data.description].filter(Boolean).join(" – ").slice(0, 200),
      },
    });
    return NextResponse.json({ status: "done", data });
  } catch (e) {
    if (!(e instanceof ReceiptAiError) && !(e instanceof SyntaxError)) throw e;
    const error = e instanceof SyntaxError ? "AI-svaret kunde inte tolkas." : e.message;
    await db.upload.update({ where: { id: upload.id }, data: { aiStatus: "error", aiError: error } });
    return NextResponse.json({ status: "error", error });
  }
}
