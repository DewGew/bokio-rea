import { CORS, OAuthError, oauthErrorResponse, readForm, revokeToken } from "@/lib/oauth";

export async function POST(req: Request) {
  try {
    await revokeToken(await readForm(req), req.headers.get("authorization"));
    return new Response(null, { status: 200, headers: CORS });
  } catch (e) {
    if (e instanceof OAuthError) return oauthErrorResponse(e);
    throw e;
  }
}

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
