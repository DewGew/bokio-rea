import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { apiCompany } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkFile, storeFile, verifyBlob } from "@/lib/storage";

/**
 * Registrerar uppladdade underlag.
 * - JSON { files: [{ url, fileName }], verificationId? }: filer som webbläsaren redan laddat upp till Vercel Blob.
 * - multipart/form-data med "files" (+ ev. "verificationId"): filen skickas hit (lokal utveckling).
 * Med verificationId bifogas underlagen direkt till ett befintligt verifikat.
 */
export async function POST(req: Request) {
  const ctx = await apiCompany();
  if (!ctx) return NextResponse.json({ error: "Du är inte inloggad." }, { status: 401 });
  const created: { id: number; fileName: string; mimeType: string }[] = [];
  try {
    const isJson = req.headers.get("content-type")?.includes("application/json");
    const body = isJson ? ((await req.json()) as { files?: { url: string; fileName: string }[]; verificationId?: number }) : null;
    const fd = isJson ? null : await req.formData();
    const verificationId = Number(body?.verificationId ?? fd?.get("verificationId")) || null;
    if (verificationId) {
      const v = await db.verification.findFirst({ where: { id: verificationId, companyId: ctx.companyId } });
      if (!v) throw new Error("Verifikatet finns inte.");
    }

    if (body) {
      for (const f of body.files ?? []) {
        const meta = await verifyBlob(ctx.companyId, f.url);
        const err = checkFile(meta.contentType, meta.size);
        if (err) throw new Error(err);
        const u = await db.upload.create({
          data: {
            companyId: ctx.companyId,
            fileName: String(f.fileName).slice(0, 200),
            storedName: meta.pathname,
            blobUrl: meta.url,
            mimeType: meta.contentType,
            size: meta.size,
            verificationId,
          },
        });
        created.push({ id: u.id, fileName: u.fileName, mimeType: u.mimeType });
      }
    } else if (fd) {
      for (const file of fd.getAll("files")) {
        if (!(file instanceof File) || file.size === 0) continue;
        const stored = await storeFile(ctx.companyId, file);
        const u = await db.upload.create({
          data: { companyId: ctx.companyId, fileName: file.name, mimeType: file.type, size: file.size, verificationId, ...stored },
        });
        created.push({ id: u.id, fileName: u.fileName, mimeType: u.mimeType });
      }
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, ids: created.map((c) => c.id), files: created }, { status: 400 });
  }
  revalidatePath("/", "layout");
  return NextResponse.json({ ids: created.map((c) => c.id), files: created });
}
