import { CORS, OAuthError, oauthErrorResponse, readForm, tokenRequest } from "@/lib/oauth";

export async function POST(req: Request) {
  try {
    const tokens = await tokenRequest(await readForm(req), req.headers.get("authorization"));
    return Response.json(tokens, { headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" } });
  } catch (e) {
    if (e instanceof OAuthError) return oauthErrorResponse(e);
    throw e;
  }
}

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
