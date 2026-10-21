import { CORS, origin, protectedResourceMetadata } from "@/lib/oauth";

// /.well-known/oauth-protected-resource[/api/mcp] skrivs om hit i next.config.ts.
export function GET(req: Request) {
  return Response.json(protectedResourceMetadata(origin(req)), { headers: { ...CORS, "Cache-Control": "public, max-age=300" } });
}

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
