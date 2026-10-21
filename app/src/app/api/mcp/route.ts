import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer } from "@/lib/mcp";
import { CORS, origin, verifyAccessToken } from "@/lib/oauth";

export const maxDuration = 60;

/** Utan giltig nyckel: 401 med hänvisning till metadata, så att Claude startar inloggningen. */
function unauthorized(req: Request) {
  const base = origin(req);
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message: "Inloggning krävs." }, id: null },
    {
      status: 401,
      headers: {
        ...CORS,
        "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/api/mcp", error="invalid_token", scope="read write"`,
      },
    },
  );
}

/**
 * MCP-servern (Streamable HTTP, tillståndslös): varje anrop autentiseras med en åtkomstnyckel från OAuth-flödet
 * och får en egen server som bara når kopplingens företag.
 */
export async function POST(req: Request) {
  const ctx = await verifyAccessToken(req.headers.get("authorization"), origin(req));
  if (!ctx) return unauthorized(req);
  const server = buildMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

// Ingen server-push (SSE) i serverlös drift: GET och DELETE stöds inte.
async function notAllowed(req: Request) {
  const ctx = await verifyAccessToken(req.headers.get("authorization"), origin(req));
  if (!ctx) return unauthorized(req);
  return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
}
export const GET = notAllowed;
export const DELETE = notAllowed;

export const OPTIONS = () => new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS" } });
