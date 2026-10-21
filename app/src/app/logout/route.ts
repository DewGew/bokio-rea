import { NextResponse } from "next/server";
import { endSession } from "@/lib/auth";

/** Utloggning efter inaktivitet (från IdleLogout). Vanlig utloggning sker via serveråtgärden logout. */
export async function GET(req: Request) {
  await endSession();
  const expired = new URL(req.url).searchParams.has("expired");
  return NextResponse.redirect(new URL(expired ? "/login?expired=1" : "/login", req.url));
}
