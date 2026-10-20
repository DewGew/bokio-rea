"use client";

import { upload } from "@vercel/blob/client";

export const ACCEPT_ALL = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif";
export type Uploaded = { id: number; fileName: string; mimeType: string };

/** Krymper stora foton (t.ex. från mobilkameran) till max 2400 px JPEG. PDF och HEIC lämnas orörda. */
async function shrink(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 2.5 * 1024 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Laddar upp filer: direkt till Vercel Blob om det är aktiverat, annars via servern. */
export async function uploadFiles(
  input: File[],
  opts: { blob: boolean; companyId: number; verificationId?: number; onStatus?: (s: string) => void },
): Promise<Uploaded[]> {
  const files = await Promise.all(input.map(shrink));
  let res: Response;
  if (opts.blob) {
    const done: { url: string; fileName: string }[] = [];
    for (const [i, f] of files.entries()) {
      opts.onStatus?.(files.length > 1 ? `Laddar upp ${i + 1} av ${files.length}…` : `Laddar upp ${f.name}…`);
      const ext = (f.name.match(/\.[a-z0-9]{1,6}$/i)?.[0] ?? "").toLowerCase();
      const b = await upload(`companies/${opts.companyId}/${crypto.randomUUID()}${ext}`, f, {
        access: "private",
        handleUploadUrl: "/api/blob",
        contentType: f.type,
      });
      done.push({ url: b.url, fileName: f.name });
    }
    opts.onStatus?.("Sparar…");
    res = await fetch("/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: done, verificationId: opts.verificationId }),
    });
  } else {
    opts.onStatus?.(files.length > 1 ? `Laddar upp ${files.length} filer…` : `Laddar upp ${files[0]?.name}…`);
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    if (opts.verificationId) fd.append("verificationId", String(opts.verificationId));
    res = await fetch("/api/uploads", { method: "POST", body: fd });
  }
  const json = (await res.json().catch(() => ({}))) as { files?: Uploaded[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Uppladdningen misslyckades.");
  return json.files ?? [];
}
