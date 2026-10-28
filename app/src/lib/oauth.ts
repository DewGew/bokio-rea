import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { db } from "./db";
import { featureFor } from "./features";
import { hashToken } from "./token";

/**
 * OAuth 2.1-server för MCP-kopplingar (Claude m.fl.), enligt MCP-specifikationens krav på auktorisering:
 * metadata (RFC 8414 och RFC 9728), dynamisk klientregistrering (RFC 7591) eller klientmetadata via URL,
 * PKCE med S256, resursindikatorer (RFC 8707), korta åtkomstnycklar och förnyelsenycklar som byts vid varje användning.
 */

export const ACCESS_TTL = 60 * 60; // sekunder
const REFRESH_TTL_DAYS = 30;
const CODE_TTL = 60;
const METADATA_REFRESH_MS = 24 * 3600_000;

/** Roller som får koppla Claude (revisorer med läsbehörighet kan inte i nuläget). */
export const MCP_ROLES = ["owner", "full"];
export const SCOPES = ["read", "write"] as const;
export const SCOPE_LABEL: Record<string, string> = {
  read: "Läsa bokföring, rapporter, fakturor och moms",
  write: "Bokföra med mall, bokföra bankrader, skapa fakturautkast, registrera betalningar och lägga till kunder och artiklar",
};

export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function origin(req: Request) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** Samma som origin(), för sidor och serveråtgärder. */
export async function headerOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

export const mcpResource = (base: string) => `${base}/api/mcp`;
const sameResource = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

export function authorizationServerMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [...SCOPES],
    client_id_metadata_document_supported: true,
  };
}

export function protectedResourceMetadata(base: string) {
  return {
    resource: mcpResource(base),
    authorization_servers: [base],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Kapima Bokför",
  };
}

const random = (bytes = 32) => randomBytes(bytes).toString("base64url");

// ---------- Klienter ----------

/** Tillåtna återkomstadresser: https, eller http mot den egna datorn (t.ex. MCP Inspector och Claude Code). */
function validRedirect(uri: string) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Dynamisk klientregistrering (RFC 7591). */
export async function registerClient(body: Record<string, unknown>) {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length || uris.length > 10 || !uris.every(validRedirect)) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris måste vara https-adresser (eller http mot localhost).");
  }
  const method = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) {
    throw new OAuthError("invalid_client_metadata", "Autentiseringsmetoden stöds inte.");
  }
  const name = (typeof body.client_name === "string" && body.client_name.trim().slice(0, 100)) || "MCP-klient";
  const id = `hb_${random(16)}`;
  const secret = method === "none" ? null : random(32);
  await db.oAuthClient.create({ data: { id, name, redirectUris: uris, secretHash: secret ? hashToken(secret) : null } });
  return {
    client_id: id,
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: method,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
  };
}

/** Metadatadokument på en https-adress (client_id är adressen). Hämtas med strikta gränser. */
async function fetchClientMetadata(url: string) {
  const u = new URL(url);
  const host = u.hostname;
  // Bara publika https-adresser med en sökväg – inga lokala eller interna värdar.
  if (u.protocol !== "https:" || u.pathname === "/" || /^(localhost|.*\.local|.*\.internal|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(host)) {
    throw new OAuthError("invalid_client", "Ogiltigt client_id.");
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "error", headers: { Accept: "application/json" } }).catch(() => null);
  if (!res?.ok) throw new OAuthError("invalid_client", "Klientens metadata kunde inte hämtas.");
  const text = await res.text();
  if (text.length > 64_000) throw new OAuthError("invalid_client", "Klientens metadata är för stor.");
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new OAuthError("invalid_client", "Klientens metadata är inte giltig JSON.");
  }
  if (doc.client_id !== url) throw new OAuthError("invalid_client", "client_id i metadatan stämmer inte.");
  const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter((x): x is string => typeof x === "string" && validRedirect(x)) : [];
  if (!uris.length) throw new OAuthError("invalid_client", "Klienten saknar giltiga redirect_uris.");
  const name = (typeof doc.client_name === "string" && doc.client_name.trim().slice(0, 100)) || u.hostname;
  return db.oAuthClient.upsert({
    where: { id: url },
    create: { id: url, name, redirectUris: uris, metadataUrl: true, fetchedAt: new Date() },
    update: { name, redirectUris: uris, fetchedAt: new Date() },
  });
}

export async function getClient(clientId: string) {
  if (!clientId || clientId.length > 500) return null;
  const stored = await db.oAuthClient.findUnique({ where: { id: clientId } });
  if (clientId.startsWith("https://")) {
    if (stored?.fetchedAt && Date.now() - stored.fetchedAt.getTime() < METADATA_REFRESH_MS) return stored;
    return fetchClientMetadata(clientId);
  }
  return stored;
}

// ---------- Auktorisering ----------

export type AuthorizeRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope: string;
  resource: string;
};

/**
 * Kontrollerar en auktoriseringsbegäran. Fel i klient eller återkomstadress visas i appen (vi får inte skicka
 * användaren vidare till en okänd adress); övriga fel skickas tillbaka till klienten.
 */
export async function checkAuthorize(p: Record<string, string | undefined>, base: string): Promise<AuthorizeRequest | { fatal: string } | { redirect: string }> {
  let client;
  try {
    client = await getClient(p.client_id ?? "");
  } catch (e) {
    return { fatal: e instanceof OAuthError ? e.message : "Okänd klient." };
  }
  if (!client) return { fatal: "Okänd klient. Ta bort kopplingen i Claude och lägg till den igen." };
  const redirectUri = p.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!client.redirectUris.includes(redirectUri)) return { fatal: "Återkomstadressen stämmer inte med klientens registrering." };

  const fail = (error: string, description: string) => {
    const u = new URL(redirectUri);
    u.searchParams.set("error", error);
    u.searchParams.set("error_description", description);
    if (p.state) u.searchParams.set("state", p.state);
    u.searchParams.set("iss", base);
    return { redirect: u.toString() };
  };
  if (p.response_type !== "code") return fail("unsupported_response_type", "Bara response_type=code stöds.");
  if (!p.code_challenge || p.code_challenge_method !== "S256") return fail("invalid_request", "PKCE med S256 krävs.");
  const requested = (p.scope ?? "read").split(/\s+/).filter(Boolean);
  if (requested.some((s) => !(SCOPES as readonly string[]).includes(s))) return fail("invalid_scope", `Tillgängliga behörigheter: ${SCOPES.join(", ")}.`);
  const resource = p.resource ?? mcpResource(base);
  if (!sameResource(resource, mcpResource(base))) return fail("invalid_target", "Okänd resurs.");

  return {
    clientId: client.id,
    clientName: client.name,
    redirectUri,
    state: p.state ?? "",
    codeChallenge: p.code_challenge,
    scope: requested.length ? requested.join(" ") : "read",
    resource: mcpResource(base),
  };
}

/** Skapar en engångskod efter att användaren godkänt och returnerar adressen klienten ska skickas till. */
export async function issueCode(req: AuthorizeRequest, userId: number, companyId: number, base: string) {
  const code = random(32);
  await db.oAuthCode.create({
    data: {
      codeHash: hashToken(code),
      clientId: req.clientId,
      userId,
      companyId,
      scope: req.scope,
      redirectUri: req.redirectUri,
      codeChallenge: req.codeChallenge,
      resource: req.resource,
      expiresAt: new Date(Date.now() + CODE_TTL * 1000),
    },
  });
  const u = new URL(req.redirectUri);
  u.searchParams.set("code", code);
  if (req.state) u.searchParams.set("state", req.state);
  u.searchParams.set("iss", base);
  return u.toString();
}

// ---------- Nycklar ----------

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Klientautentisering vid nyckelutbyte: publika klienter (none) eller hemlighet i formulär/Basic-huvud. */
async function authenticateClient(form: URLSearchParams, authHeader: string | null) {
  let id = form.get("client_id") ?? "";
  let secret = form.get("client_secret");
  if (authHeader?.startsWith("Basic ")) {
    const [u, s] = Buffer.from(authHeader.slice(6), "base64").toString().split(":");
    id = decodeURIComponent(u ?? "");
    secret = decodeURIComponent(s ?? "");
  }
  const client = id ? await getClient(id).catch(() => null) : null;
  if (!client) throw new OAuthError("invalid_client", "Okänd klient.", 401);
  if (client.secretHash && (!secret || !safeEqual(hashToken(secret), client.secretHash))) throw new OAuthError("invalid_client", "Fel klienthemlighet.", 401);
  return client;
}

async function issueTokens(grantId: number, scope: string) {
  const access = random(32);
  const refresh = random(32);
  await db.oAuthToken.createMany({
    data: [
      { tokenHash: hashToken(access), grantId, kind: "access", expiresAt: new Date(Date.now() + ACCESS_TTL * 1000) },
      { tokenHash: hashToken(refresh), grantId, kind: "refresh", expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000) },
    ],
  });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope };
}

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

async function allowed(userId: number, companyId: number) {
  const m = await db.membership.findUnique({ where: { userId_companyId: { userId, companyId } }, include: { company: { select: { plan: true } } } });
  // Kopplingen till Claude ingår i Pro och kan stängas av för hela appen.
  return !!m && MCP_ROLES.includes(m.role) && (await featureFor(m.company, "mcp")).available;
}

/** Token-endpoint: authorization_code och refresh_token. */
export async function tokenRequest(form: URLSearchParams, authHeader: string | null) {
  const client = await authenticateClient(form, authHeader);
  const grantType = form.get("grant_type");

  if (grantType === "authorization_code") {
    const code = await db.oAuthCode.findUnique({ where: { codeHash: hashToken(form.get("code") ?? "") } });
    if (!code || code.clientId !== client.id) throw new OAuthError("invalid_grant", "Ogiltig kod.");
    // Koden får bara användas en gång (villkorlig uppdatering skyddar mot samtidiga försök).
    const used = await db.oAuthCode.updateMany({ where: { codeHash: code.codeHash, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1 || code.expiresAt < new Date()) throw new OAuthError("invalid_grant", "Koden är använd eller har gått ut.");
    if ((form.get("redirect_uri") ?? code.redirectUri) !== code.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri stämmer inte.");
    const verifier = form.get("code_verifier") ?? "";
    if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier) || !safeEqual(s256(verifier), code.codeChallenge)) throw new OAuthError("invalid_grant", "PKCE-verifieringen misslyckades.");
    const resource = form.get("resource");
    if (resource && !sameResource(resource, code.resource)) throw new OAuthError("invalid_target", "Okänd resurs.");
    if (!(await allowed(code.userId, code.companyId))) throw new OAuthError("access_denied", "Användaren har inte längre behörighet.");
    const grant = await db.oAuthGrant.create({ data: { clientId: client.id, userId: code.userId, companyId: code.companyId, scope: code.scope, resource: code.resource } });
    return issueTokens(grant.id, grant.scope);
  }

  if (grantType === "refresh_token") {
    const old = await db.oAuthToken.findUnique({ where: { tokenHash: hashToken(form.get("refresh_token") ?? "") }, include: { grant: true } });
    if (!old || old.kind !== "refresh" || old.grant.clientId !== client.id) throw new OAuthError("invalid_grant", "Ogiltig förnyelsenyckel.");
    if (old.revokedAt) {
      // En redan använd förnyelsenyckel används igen: kan vara stulen, så hela kopplingen stängs.
      await revokeGrant(old.grantId);
      throw new OAuthError("invalid_grant", "Förnyelsenyckeln är redan använd. Kopplingen har stängts av säkerhetsskäl.");
    }
    if (old.expiresAt < new Date() || old.grant.revokedAt) throw new OAuthError("invalid_grant", "Kopplingen har gått ut eller återkallats.");
    if (!(await allowed(old.grant.userId, old.grant.companyId))) {
      await revokeGrant(old.grantId);
      throw new OAuthError("invalid_grant", "Användaren har inte längre behörighet.");
    }
    const rotated = await db.oAuthToken.updateMany({ where: { tokenHash: old.tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
    if (rotated.count !== 1) throw new OAuthError("invalid_grant", "Förnyelsenyckeln är redan använd.");
    return issueTokens(old.grantId, old.grant.scope);
  }

  throw new OAuthError("unsupported_grant_type", "grant_type stöds inte.");
}

export async function revokeGrant(grantId: number) {
  const now = new Date();
  await db.$transaction([
    db.oAuthGrant.updateMany({ where: { id: grantId, revokedAt: null }, data: { revokedAt: now } }),
    db.oAuthToken.updateMany({ where: { grantId, revokedAt: null }, data: { revokedAt: now } }),
  ]);
}

/** RFC 7009: återkallar kopplingen som nyckeln hör till. Svarar alltid OK. */
export async function revokeToken(form: URLSearchParams, authHeader: string | null) {
  const client = await authenticateClient(form, authHeader);
  const t = await db.oAuthToken.findUnique({ where: { tokenHash: hashToken(form.get("token") ?? "") }, include: { grant: true } });
  if (t && t.grant.clientId === client.id) await revokeGrant(t.grantId);
}

export type McpContext = { grantId: number; userId: number; companyId: number; scopes: string[]; clientName: string };

/** Kontrollerar en åtkomstnyckel vid varje MCP-anrop, inklusive att användaren fortfarande har behörighet. */
export async function verifyAccessToken(header: string | null, base: string): Promise<McpContext | null> {
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const t = await db.oAuthToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { grant: { include: { client: { select: { name: true } } } } } });
  if (!t || t.kind !== "access" || t.revokedAt || t.expiresAt < new Date() || t.grant.revokedAt) return null;
  if (!sameResource(t.grant.resource, mcpResource(base))) return null;
  if (!(await allowed(t.grant.userId, t.grant.companyId))) {
    await revokeGrant(t.grantId);
    return null;
  }
  if (!t.grant.lastUsedAt || Date.now() - t.grant.lastUsedAt.getTime() > 60_000) {
    await db.oAuthGrant.update({ where: { id: t.grantId }, data: { lastUsedAt: new Date() } });
  }
  return { grantId: t.grantId, userId: t.grant.userId, companyId: t.grant.companyId, scopes: t.grant.scope.split(" "), clientName: t.grant.client.name };
}

/** CORS för de endpoints som webbaserade klienter anropar direkt (metadata, registrering, token). */
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
};

export function oauthErrorResponse(e: OAuthError) {
  return Response.json({ error: e.code, error_description: e.message }, { status: e.status, headers: { ...CORS, "Cache-Control": "no-store" } });
}

/** Läser formulär (standard) eller JSON. */
export async function readForm(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return new URLSearchParams(Object.entries(body).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  }
  return new URLSearchParams(await req.text());
}
