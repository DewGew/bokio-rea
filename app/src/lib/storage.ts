import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { del, get, head, put } from "@vercel/blob";
import type { Upload } from "@prisma/client";

/**
 * Lagring av underlag.
 * - I produktion (BLOB_READ_WRITE_TOKEN satt): privat Vercel Blob. Webbläsaren laddar upp direkt
 *   till Blob (förbi Vercels gräns på 4,5 MB per anrop) och filerna serveras via /api/files efter behörighetskontroll.
 * - Lokalt: filer i mappen uploads/.
 */
export const blobEnabled = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
export const MAX_SIZE = 20 * 1024 * 1024;
const LOCAL_DIR = path.join(process.cwd(), "uploads");

export function companyPrefix(companyId: number) {
  return `companies/${companyId}/`;
}

export function newPathname(companyId: number, fileName: string) {
  const ext = path.extname(fileName).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 6);
  return `${companyPrefix(companyId)}${randomUUID()}${ext}`;
}

export function checkFile(type: string, size: number) {
  if (!ALLOWED_TYPES.includes(type)) return `Filtypen ${type || "okänd"} stöds inte. Använd PDF, JPG, PNG, WEBP eller HEIC.`;
  if (size > MAX_SIZE) return "Filen är större än 20 MB.";
  return null;
}

/** Sparar en fil som skickats till servern (används lokalt och för små filer). */
export async function storeFile(companyId: number, file: File) {
  const err = checkFile(file.type, file.size);
  if (err) throw new Error(err);
  const pathname = newPathname(companyId, file.name);
  if (blobEnabled()) {
    const res = await put(pathname, file, { access: "private", contentType: file.type });
    return { storedName: res.pathname, blobUrl: res.url };
  }
  const full = path.join(LOCAL_DIR, pathname);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, Buffer.from(await file.arrayBuffer()));
  return { storedName: pathname, blobUrl: null };
}

/** Kontrollerar att en direktuppladdad blob finns och hör till företaget. */
export async function verifyBlob(companyId: number, url: string) {
  const meta = await head(url);
  if (!meta.pathname.startsWith(companyPrefix(companyId))) throw new Error("Filen tillhör inte företaget.");
  return meta;
}

function localPath(storedName: string) {
  const full = path.resolve(LOCAL_DIR, storedName);
  return full.startsWith(LOCAL_DIR + path.sep) ? full : null;
}

export async function fileResponse(u: Upload, download = false) {
  const headers = new Headers({
    "Content-Type": u.mimeType,
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(u.fileName)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  });
  if (u.blobUrl) {
    const res = await get(u.blobUrl, { access: "private" });
    if (!res || res.statusCode !== 200) return new Response("Hittades inte", { status: 404 });
    return new Response(res.stream, { headers });
  }
  const p = localPath(u.storedName);
  const data = p && (await readFile(p).catch(() => null));
  if (!data) return new Response("Hittades inte", { status: 404 });
  return new Response(new Uint8Array(data), { headers });
}

export async function deleteStored(u: Upload) {
  if (u.blobUrl) await del(u.blobUrl).catch(() => {});
  else {
    const p = localPath(u.storedName);
    if (p) await unlink(p).catch(() => {});
  }
}
