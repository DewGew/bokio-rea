"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { featureFor } from "@/lib/features";
import { requireUser } from "@/lib/auth";
import { MCP_ROLES, checkAuthorize, headerOrigin, issueCode } from "@/lib/oauth";

const PARAMS = ["response_type", "client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource"];

function params(fd: FormData) {
  return Object.fromEntries(PARAMS.map((k) => [k, typeof fd.get(k) === "string" && fd.get(k) !== "" ? String(fd.get(k)) : undefined]));
}

function back(p: Record<string, string | undefined>, error: string): never {
  const q = new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1]));
  q.set("error", error);
  redirect(`/oauth/authorize?${q}`);
}

/** Användaren godkänner: en engångskod skapas och användaren skickas tillbaka till Claude. */
export async function approveConsent(fd: FormData) {
  const s = await requireUser();
  const p = params(fd);
  const base = await headerOrigin();
  const req = await checkAuthorize(p, base);
  if ("fatal" in req) back(p, req.fatal);
  if ("redirect" in req) redirect(req.redirect);
  const companyId = Number(fd.get("companyId"));
  const m = s.user.memberships.find((x) => x.companyId === companyId);
  if (!m || !MCP_ROLES.includes(m.role)) back(p, "Välj ett företag där du är ägare eller har full behörighet.");
  const mcp = await db.company.findUnique({ where: { id: companyId }, select: { plan: true } });
  if (!mcp || !(await featureFor(mcp, "mcp")).available) back(p, "Koppling till Claude ingår i Pro och är inte aktiverad för det här företaget.");
  // Användaren väljer nivå på godkännandesidan (läsa, eller läsa och bokföra).
  const scope = fd.get("level") === "write" ? "read write" : "read";
  redirect(await issueCode({ ...req, scope }, s.userId, companyId, base));
}

/** Användaren avböjer: Claude får beskedet access_denied. */
export async function denyConsent(fd: FormData) {
  await requireUser();
  const p = params(fd);
  const req = await checkAuthorize(p, await headerOrigin());
  if ("fatal" in req) back(p, req.fatal);
  if ("redirect" in req) redirect(req.redirect);
  const u = new URL(req.redirectUri);
  u.searchParams.set("error", "access_denied");
  u.searchParams.set("error_description", "Användaren avböjde.");
  if (req.state) u.searchParams.set("state", req.state);
  u.searchParams.set("iss", await headerOrigin());
  redirect(u.toString());
}
