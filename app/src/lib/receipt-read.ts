import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { readStored } from "./storage";
import { featureFor } from "./features";
import { AI_VERSION, ReceiptAiError, aiEnabled, readReceipt, type ReceiptData } from "./receipt-ai";

const READABLE = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf", "text/plain"];

export type ReadResult = { status: "done"; data: ReceiptData } | { status: "disabled" } | { status: "error"; error: string; notFound?: boolean };

/**
 * Läser av ett underlag med AI och sparar resultatet, så att samma kvitto bara läses en gång (force läser om).
 * Fyller även i belopp (bara i kronor), datum och beskrivning på underlaget om de saknas.
 * Används av knappen i appen och av mejlmottagningen.
 */
export async function readUpload(companyId: number, uploadId: number, opts: { force?: boolean } = {}): Promise<ReadResult> {
  const upload = await db.upload.findFirst({ where: { id: uploadId, companyId } });
  if (!upload) return { status: "error", error: "Underlaget finns inte.", notFound: true };
  const cached = upload.aiData as ReceiptData | null;
  // Äldre avläsningar (före AI_VERSION) görs om, så att de får en mall.
  const outdated = !!cached && (cached.version ?? 1) < AI_VERSION;
  if (upload.aiStatus === "done" && cached && !opts.force && !outdated) return { status: "done", data: cached };
  if (!aiEnabled()) return { status: "disabled" };
  // AI-avläsning ingår i Pro och kan stängas av för hela appen. Redan lästa underlag visas ändå (se ovan).
  const owner = await db.company.findUnique({ where: { id: companyId }, select: { plan: true } });
  if (!owner || !(await featureFor(owner, "ai")).available) return { status: "disabled" };
  if (!READABLE.includes(upload.mimeType)) return { status: "error", error: "Filtypen kan inte läsas av." };

  const bytes = await readStored(upload);
  if (!bytes) return { status: "error", error: "Filen kunde inte läsas.", notFound: true };
  // Underlag är inköp: försäljningsmallar ska aldrig föreslås.
  const templates = await db.template.findMany({ where: { companyId, direction: { not: "sale" } }, select: { id: true, name: true, description: true } });

  try {
    const data = await readReceipt({ bytes, mime: upload.mimeType, name: upload.fileName }, templates);
    const date = data.date ? new Date(`${data.date}T00:00:00Z`) : null;
    await db.upload.update({
      where: { id: upload.id },
      data: {
        aiStatus: "done",
        aiData: data as unknown as Prisma.InputJsonValue,
        aiError: null,
        amount: upload.amount ?? (data.total && data.currency === "SEK" ? Math.round(data.total * 100) : null),
        date: upload.date ?? date,
        description: (opts.force || outdated ? "" : upload.description) || [data.supplier, data.description].filter(Boolean).join(" – ").slice(0, 200),
      },
    });
    return { status: "done", data };
  } catch (e) {
    if (!(e instanceof ReceiptAiError) && !(e instanceof SyntaxError)) throw e;
    const error = e instanceof SyntaxError ? "AI-svaret kunde inte tolkas." : e.message;
    await db.upload.update({ where: { id: upload.id }, data: { aiStatus: "error", aiError: error } });
    return { status: "error", error };
  }
}
