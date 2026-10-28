import { NextResponse, type NextRequest } from "next/server";

// Snabb kontroll i kanten: utan sessionscookie skickas man till inloggningen.
// Den riktiga kontrollen av sessionen görs i requireCompany()/apiCompany().
const PUBLIC = ["/login", "/register"];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p) || pathname.startsWith("/api/") || pathname.startsWith("/invite/") || pathname.startsWith("/reset/") || pathname.startsWith("/.well-known/")) return NextResponse.next();
  if (!req.cookies.has("hb_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Statiska filer i public/ (t.ex. pdf.js-workern) kräver ingen inloggning.
  matcher: ["/((?!_next/|favicon.ico|.*\\.(?:mjs|js|svg|png|jpg|ico|txt)$).*)"],
};
