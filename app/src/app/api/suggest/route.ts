import { NextResponse } from "next/server";
import { apiCompany } from "@/lib/auth";
import { suggest } from "@/lib/suggest";

/** Konteringsförslag för en beskrivning: GET /api/suggest?q=telia mobil */
export async function GET(req: Request) {
  const ctx = await apiCompany();
  if (!ctx) return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 120);
  return NextResponse.json({ suggestions: await suggest(ctx.companyId, q) }, { headers: { "Cache-Control": "private, no-store" } });
}
