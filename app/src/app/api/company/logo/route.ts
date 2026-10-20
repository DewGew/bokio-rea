import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { apiCompany } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteStored, fileResponse, storeFile } from "@/lib/storage";

const LOGO_TYPES = ["image/png", "image/jpeg"];

/** Visar företagets logotyp. */
export async function GET() {
  const ctx = await apiCompany();
  if (!ctx) return new Response("Inte inloggad", { status: 401 });
  const c = await db.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
  if (!c.logoStoredName || !c.logoMime) return new Response("Ingen logotyp", { status: 404 });
  return fileResponse({ storedName: c.logoStoredName, blobUrl: c.logoBlobUrl, mimeType: c.logoMime, fileName: "logotyp" });
}

/** Laddar upp en ny logotyp (PNG/JPEG, konverterad och nedskalad i webbläsaren). */
export async function POST(req: Request) {
  const ctx = await apiCompany();
  if (!ctx) return NextResponse.json({ error: "Du är inte inloggad." }, { status: 401 });
  const file = (await req.formData()).get("logo");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Välj en bild." }, { status: 400 });
  if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: "Logotypen får vara högst 2 MB." }, { status: 400 });
  try {
    const stored = await storeFile(ctx.companyId, file, { folder: "logo/", allowed: LOGO_TYPES });
    const old = await db.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
    await db.company.update({
      where: { id: ctx.companyId },
      data: { logoStoredName: stored.storedName, logoBlobUrl: stored.blobUrl, logoMime: file.type },
    });
    if (old.logoStoredName) await deleteStored({ storedName: old.logoStoredName, blobUrl: old.logoBlobUrl });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const ctx = await apiCompany();
  if (!ctx) return NextResponse.json({ error: "Du är inte inloggad." }, { status: 401 });
  const c = await db.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
  await db.company.update({ where: { id: ctx.companyId }, data: { logoStoredName: null, logoBlobUrl: null, logoMime: null } });
  if (c.logoStoredName) await deleteStored({ storedName: c.logoStoredName, blobUrl: c.logoBlobUrl });
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true });
}
