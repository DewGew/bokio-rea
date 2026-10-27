import "server-only";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { del, get, head, list, put } from "@vercel/blob";

/**
 * Lagring av underlag och logotyper.
 * - Med en Vercel Blob-token: privat Vercel Blob. Webbläsaren laddar upp direkt till Blob (förbi Vercels
 *   gräns på 4,5 MB per anrop) och filerna serveras via /api/files efter behörighetskontroll.
 * - Lokalt utan token: filer i mappen uploads/.
 */

function envWithPrefix(name: string) {
  if (process.env[name]) return process.env[name];
  const key = Object.keys(process.env).find((k) => k.endsWith(`_${name}`) && process.env[k]);
  return key ? process.env[key] : undefined;
}

/** Read-write-token, även om integrationen gett variabeln ett prefix (t.ex. STORAGE_BLOB_READ_WRITE_TOKEN). */
export function blobToken() {
  return envWithPrefix("BLOB_READ_WRITE_TOKEN");
}

/** Nyare Blob-stores ansluts med OIDC: Vercel sätter BLOB_STORE_ID och ger funktionen en OIDC-token. */
export function blobStoreId() {
  return envWithPrefix("BLOB_STORE_ID");
}

/** Inloggningsuppgifter till Blob-anropen: read-write-token om den finns, annars OIDC via store-id. */
function auth(): { token?: string; storeId?: string } {
  const token = blobToken();
  if (token) return { token };
  const storeId = blobStoreId();
  return storeId ? { storeId } : {};
}

export const blobEnabled = () => !!(blobToken() || blobStoreId());

/**
 * Direktuppladdning från webbläsaren kräver en read-write-token. Med bara OIDC går filerna via servern,
 * där Vercel begränsar varje anrop till 4,5 MB (stora foton krymps i webbläsaren innan uppladdning).
 */
export const directUploadEnabled = () => !!blobToken();
export const serverUploadLimit = () => (process.env.VERCEL ? 4.3 * 1024 * 1024 : null);

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
  if (/oidc|credentials/i.test(msg)) {
    throw new StorageError(
      "Vercel Blob kunde inte autentisera med OIDC. Kontrollera att Secure Backend Access (OIDC) är påslaget under Settings → Security, eller lägg till BLOB_READ_WRITE_TOKEN som miljövariabel, och gör Redeploy.",
    );
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
  if (blobEnabled()) {
    try {
      const res = await put(pathname, file, { access: "private", contentType: file.type, ...auth() });
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
    meta = await head(url, auth());
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
    const res = await get(s.blobUrl, { access: "private", ...auth() }).catch(() => null);
    if (!res || res.statusCode !== 200) return null;
    return new Uint8Array(await new Response(res.stream).arrayBuffer());
  }
  const p = localPath(s.storedName);
  const data = p && (await readFile(p).catch(() => null));
  return data ? new Uint8Array(data) : null;
}

export async function fileResponse(u: Stored & { mimeType: string; fileName: string }, download = false) {
  const headers = new Headers({
    "Content-Type": u.mimeType === "text/plain" ? "text/plain; charset=utf-8" : u.mimeType,
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(u.fileName)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  });
  if (u.blobUrl) {
    const res = await get(u.blobUrl, { access: "private", ...auth() }).catch(() => null);
    if (!res || res.statusCode !== 200) return new Response("Hittades inte", { status: 404 });
    return new Response(res.stream, { headers });
  }
  const p = localPath(u.storedName);
  const data = p && (await readFile(p).catch(() => null));
  if (!data) return new Response("Hittades inte", { status: 404 });
  return new Response(new Uint8Array(data), { headers });
}

export async function deleteStored(u: Stored) {
  if (u.blobUrl) await del(u.blobUrl, auth()).catch(() => {});
  else {
    const p = localPath(u.storedName);
    if (p) await unlink(p).catch(() => {});
  }
}

export type StoredFile = { pathname: string; size: number; uploadedAt: Date; blobUrl: string | null };

/** Alla filer i lagringen (för administratörens översikt). Bara metadata, aldrig innehåll. */
export async function listStoredFiles(): Promise<StoredFile[]> {
  const out: StoredFile[] = [];
  if (blobEnabled()) {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: "companies/", limit: 1000, cursor, ...auth() });
      for (const b of page.blobs) out.push({ pathname: b.pathname, size: b.size, uploadedAt: b.uploadedAt, blobUrl: b.url });
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }
  async function walk(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        const st = await stat(full);
        out.push({ pathname: path.relative(LOCAL_DIR, full).split(path.sep).join("/"), size: st.size, uploadedAt: st.mtime, blobUrl: null });
      }
    }
  }
  await walk(LOCAL_DIR);
  return out;
}

/** Kontrollerar kontakten med lagringen. */
export async function pingStorage(): Promise<{ ok: boolean; backend: string; message: string }> {
  if (blobEnabled()) {
    try {
      await list({ prefix: "companies/", limit: 1, ...auth() });
      return { ok: true, backend: "Vercel Blob", message: "Svarar" };
    } catch (e) {
      return { ok: false, backend: "Vercel Blob", message: (e as Error).message.slice(0, 200) };
    }
  }
  if (process.env.VERCEL) return { ok: false, backend: "Ingen", message: STORAGE_MISSING };
  return { ok: true, backend: "Lokal disk", message: LOCAL_DIR };
}
