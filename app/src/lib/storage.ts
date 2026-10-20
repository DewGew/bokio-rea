import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { del, get, head, put } from "@vercel/blob";

/**
 * Lagring av underlag och logotyper.
 * - Med en Vercel Blob-token: privat Vercel Blob. Webbläsaren laddar upp direkt till Blob (förbi Vercels
 *   gräns på 4,5 MB per anrop) och filerna serveras via /api/files efter behörighetskontroll.
 * - Lokalt utan token: filer i mappen uploads/.
 */

/** Blob-token, även om integrationen gett variabeln ett prefix (t.ex. STORAGE_BLOB_READ_WRITE_TOKEN). */
export function blobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const key = Object.keys(process.env).find((k) => k.endsWith("_BLOB_READ_WRITE_TOKEN") && process.env[k]);
  return key ? process.env[key] : undefined;
}

export const blobEnabled = () => !!blobToken();

/** På Vercel finns ingen skrivbar disk, så utan Blob går det inte att spara filer. */
export const STORAGE_MISSING =
  "Fillagring är inte konfigurerad. Koppla en Vercel Blob-store (åtkomst: Private) till projektet under Storage och gör Redeploy.";

export class StorageError extends Error {}

export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
export const MAX_SIZE = 20 * 1024 * 1024;
const LOCAL_DIR = path.join(process.cwd(), "uploads");

export type Stored = { storedName: string; blobUrl: string | null };

export function companyPrefix(companyId: number) {
  return `companies/${companyId}/`;
}

export function newPathname(companyId: number, fileName: string, folder = "") {
  const ext = path.extname(fileName).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 6);
  return `${companyPrefix(companyId)}${folder}${randomUUID()}${ext}`;
}

export function checkFile(type: string, size: number, allowed = ALLOWED_TYPES) {
  if (!allowed.includes(type)) return `Filtypen ${type || "okänd"} stöds inte. Använd PDF, JPG, PNG, WEBP eller HEIC.`;
  if (size > MAX_SIZE) return "Filen är större än 20 MB.";
  return null;
}

/** Översätter Blob-fel till begripliga meddelanden. */
function blobError(e: unknown): never {
  const msg = (e as Error)?.message ?? String(e);
  if (/private/i.test(msg) && /public/i.test(msg)) {
    throw new StorageError("Blob-storen är publik. Skapa en ny Blob-store med åtkomst Private och koppla den till projektet.");
  }
  if (/token|unauthori[sz]ed|forbidden/i.test(msg)) {
    throw new StorageError("Vercel Blob nekade åtkomst. Kontrollera att Blob-storen är kopplad till projektet och gör Redeploy.");
  }
  throw new StorageError(`Kunde inte spara filen: ${msg}`);
}

/** Sparar en fil som skickats till servern (lokalt, och för små filer som logotyper). */
export async function storeFile(companyId: number, file: File, opts: { folder?: string; allowed?: string[] } = {}): Promise<Stored> {
  const err = checkFile(file.type, file.size, opts.allowed);
  if (err) throw new StorageError(err);
  const pathname = newPathname(companyId, file.name, opts.folder);
  const token = blobToken();
  if (token) {
    try {
      const res = await put(pathname, file, { access: "private", contentType: file.type, token });
      return { storedName: res.pathname, blobUrl: res.url };
    } catch (e) {
      blobError(e);
    }
  }
  if (process.env.VERCEL) throw new StorageError(STORAGE_MISSING);
  const full = path.join(LOCAL_DIR, pathname);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, Buffer.from(await file.arrayBuffer()));
  return { storedName: pathname, blobUrl: null };
}

/** Kontrollerar att en direktuppladdad blob finns och hör till företaget. */
export async function verifyBlob(companyId: number, url: string) {
  let meta;
  try {
    meta = await head(url, { token: blobToken() });
  } catch (e) {
    blobError(e);
  }
  if (!meta.pathname.startsWith(companyPrefix(companyId))) throw new StorageError("Filen tillhör inte företaget.");
  return meta;
}

function localPath(storedName: string) {
  const full = path.resolve(LOCAL_DIR, storedName);
  return full.startsWith(LOCAL_DIR + path.sep) ? full : null;
}

/** Läser en lagrad fil som bytes (används t.ex. för logotypen i PDF-fakturor). */
export async function readStored(s: Stored): Promise<Uint8Array | null> {
  if (s.blobUrl) {
    const res = await get(s.blobUrl, { access: "private", token: blobToken() }).catch(() => null);
    if (!res || res.statusCode !== 200) return null;
    return new Uint8Array(await new Response(res.stream).arrayBuffer());
  }
  const p = localPath(s.storedName);
  const data = p && (await readFile(p).catch(() => null));
  return data ? new Uint8Array(data) : null;
}

export async function fileResponse(u: Stored & { mimeType: string; fileName: string }, download = false) {
  const headers = new Headers({
    "Content-Type": u.mimeType,
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(u.fileName)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  });
  if (u.blobUrl) {
    const res = await get(u.blobUrl, { access: "private", token: blobToken() }).catch(() => null);
    if (!res || res.statusCode !== 200) return new Response("Hittades inte", { status: 404 });
    return new Response(res.stream, { headers });
  }
  const p = localPath(u.storedName);
  const data = p && (await readFile(p).catch(() => null));
  if (!data) return new Response("Hittades inte", { status: 404 });
  return new Response(new Uint8Array(data), { headers });
}

export async function deleteStored(u: Stored) {
  if (u.blobUrl) await del(u.blobUrl, { token: blobToken() }).catch(() => {});
  else {
    const p = localPath(u.storedName);
    if (p) await unlink(p).catch(() => {});
  }
}
