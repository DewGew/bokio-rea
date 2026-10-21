import { CORS, authorizationServerMetadata, origin } from "@/lib/oauth";

// /.well-known/oauth-authorization-server (och openid-configuration) skrivs om hit i next.config.ts.
export function GET(req: Request) {
  return Response.json(authorizationServerMetadata(origin(req)), { headers: { ...CORS, "Cache-Control": "public, max-age=300" } });
}

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
