import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { apiCompany } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkFile, storeFile, verifyBlob } from "@/lib/storage";

/**
 * Registrerar uppladdade underlag.
 * - JSON { files: [{ url, fileName }] }: filer som webbläsaren redan laddat upp till Vercel Blob.
 * - multipart/form-data med "files": filen skickas hit (lokal utveckling).
 */
export async function POST(req: Request) {
  const ctx = await apiCompany();
  if (!ctx) return NextResponse.json({ error: "Inte inloggad." }, { status: 401 });
  const ids: number[] = [];
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = (await req.json()) as { files: { url: string; fileName: string }[] };
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
          },
        });
        ids.push(u.id);
      }
    } else {
      const fd = await req.formData();
      for (const file of fd.getAll("files")) {
        if (!(file instanceof File) || file.size === 0) continue;
        const stored = await storeFile(ctx.companyId, file);
        const u = await db.upload.create({
          data: { companyId: ctx.companyId, fileName: file.name, mimeType: file.type, size: file.size, ...stored },
        });
        ids.push(u.id);
      }
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, ids }, { status: 400 });
  }
  revalidatePath("/", "layout");
  return NextResponse.json({ ids });
}
