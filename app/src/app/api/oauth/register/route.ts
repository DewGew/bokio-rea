import { CORS, OAuthError, oauthErrorResponse, registerClient } from "@/lib/oauth";

/** Dynamisk klientregistrering (RFC 7591), används av Claude när kopplingen läggs till. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new OAuthError("invalid_client_metadata", "Ogiltig JSON.");
    return Response.json(await registerClient(body), { status: 201, headers: { ...CORS, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof OAuthError) return oauthErrorResponse(e);
    throw e;
  }
}

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
