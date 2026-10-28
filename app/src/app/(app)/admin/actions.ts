"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { adminLogOp, isAdminEmail, requireAdmin } from "@/lib/admin";
import { str, withParam } from "@/lib/action";
import { hashToken } from "@/lib/token";
import { companyBookkeeping, companyFiles, companyPurgeOps, deleteCompanyFiles } from "@/lib/company-delete";
import { revokeGrant } from "@/lib/oauth";
import { deleteStored } from "@/lib/storage";
import { findOrphans } from "@/lib/admin-system";

const back = (key: "ok" | "error", msg: string): never => redirect(withParam("/admin", key, msg));

async function target(fd: FormData) {
  const admin = await requireAdmin();
  const user = await db.user.findUnique({ where: { id: Number(str(fd, "userId")) || -1 } });
  if (!user) back("error", "Användaren finns inte.");
  return { adminEmail: admin.user.email, user: user! };
}

export async function lockUser(fd: FormData) {
  const { adminEmail, user } = await target(fd);
  if (isAdminEmail(user.email)) back("error", "Administratörer kan inte låsas.");
  if (user.lockedAt) back("error", `${user.email} är redan låst.`);
  const reason = str(fd, "reason").slice(0, 200);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { lockedAt: new Date(), lockedReason: reason } }),
    adminLogOp({ adminEmail, action: "user_locked", targetType: "user", targetId: user.id, targetLabel: user.email, details: reason }),
  ]);
  revalidatePath("/", "layout");
  back("ok", `${user.email} är låst. Användaren kan logga in men har bara läsrätt i alla sina företag.`);
}

export async function unlockUser(fd: FormData) {
  const { adminEmail, user } = await target(fd);
  if (!user.lockedAt) back("error", `${user.email} är inte låst.`);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { lockedAt: null, lockedReason: "" } }),
    adminLogOp({ adminEmail, action: "user_unlocked", targetType: "user", targetId: user.id, targetLabel: user.email }),
  ]);
  revalidatePath("/", "layout");
  back("ok", `${user.email} är upplåst.`);
}

export async function endUserSessions(fd: FormData) {
  const { adminEmail, user } = await target(fd);
  const { count } = await db.session.deleteMany({ where: { userId: user.id } });
  await adminLogOp({ adminEmail, action: "user_sessions_ended", targetType: "user", targetId: user.id, targetLabel: user.email, details: `${count} sessioner avslutade` });
  revalidatePath("/admin");
  back("ok", `${user.email} är utloggad på alla enheter (${count} sessioner).`);
}

export type ResetState = { link?: string; error?: string; email?: string } | undefined;

/** Skapar en engångslänk (giltig i 24 timmar) som administratören ger användaren. Länken visas bara en gång. */
export async function createResetLink(_: ResetState, fd: FormData): Promise<ResetState> {
  const admin = await requireAdmin();
  const user = await db.user.findUnique({ where: { id: Number(str(fd, "userId")) || -1 } });
  if (!user) return { error: "Användaren finns inte." };
  const token = randomBytes(24).toString("base64url");
  await db.$transaction([
    db.passwordReset.deleteMany({ where: { userId: user.id, usedAt: null } }),
    db.passwordReset.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 24 * 3_600_000) } }),
    adminLogOp({ adminEmail: admin.user.email, action: "password_reset_link", targetType: "user", targetId: user.id, targetLabel: user.email, details: "Giltig i 24 timmar" }),
  ]);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return { link: `${proto}://${host}/reset/${token}`, email: user.email };
}

// ---------------------------------------------------------------- Företag

const backTo = (path: string, key: "ok" | "error", msg: string): never => redirect(withParam(path, key, msg));

async function companyTarget(fd: FormData) {
  const admin = await requireAdmin();
  const company = await db.company.findUnique({ where: { id: Number(str(fd, "companyId")) || -1 }, select: { id: true, name: true, lockedAt: true } });
  if (!company) backTo("/admin", "error", "Företaget finns inte.");
  return { adminEmail: admin.user.email, company: company!, path: `/admin/companies/${company!.id}` };
}

export async function makeOwner(fd: FormData) {
  const { adminEmail, company, path } = await companyTarget(fd);
  const m = await db.membership.findUnique({
    where: { userId_companyId: { userId: Number(str(fd, "userId")) || -1, companyId: company.id } },
    include: { user: { select: { email: true } } },
  });
  if (!m) backTo(path, "error", "Användaren är inte medlem i företaget.");
  if (m!.role === "owner") backTo(path, "error", `${m!.user.email} är redan ägare.`);
  await db.$transaction([
    db.membership.update({ where: { userId_companyId: { userId: m!.userId, companyId: company.id } }, data: { role: "owner" } }),
    adminLogOp({ adminEmail, action: "company_owner_added", targetType: "company", targetId: company.id, targetLabel: company.name, details: `${m!.user.email} (var ${m!.role})` }),
  ]);
  revalidatePath(path);
  backTo(path, "ok", `${m!.user.email} är nu ägare av ${company.name}.`);
}

export async function lockCompany(fd: FormData) {
  const { adminEmail, company, path } = await companyTarget(fd);
  const reason = str(fd, "reason").slice(0, 200);
  if (!reason) backTo(path, "error", "Ange en orsak. Den visas för företagets användare.");
  if (company.lockedAt) backTo(path, "error", "Företaget är redan låst.");
  await db.$transaction([
    db.company.update({ where: { id: company.id }, data: { lockedAt: new Date(), lockedReason: reason } }),
    adminLogOp({ adminEmail, action: "company_locked", targetType: "company", targetId: company.id, targetLabel: company.name, details: reason }),
  ]);
  revalidatePath("/", "layout");
  backTo(path, "ok", `${company.name} är låst. Alla användare har bara läsrätt.`);
}

export async function unlockCompany(fd: FormData) {
  const { adminEmail, company, path } = await companyTarget(fd);
  if (!company.lockedAt) backTo(path, "error", "Företaget är inte låst.");
  await db.$transaction([
    db.company.update({ where: { id: company.id }, data: { lockedAt: null, lockedReason: "" } }),
    adminLogOp({ adminEmail, action: "company_unlocked", targetType: "company", targetId: company.id, targetLabel: company.name }),
  ]);
  revalidatePath("/", "layout");
  backTo(path, "ok", `${company.name} är upplåst.`);
}

/**
 * Raderar ett företag. Kräver att företaget är låst (ett medvetet mellansteg), att namnet skrivs,
 * och att all bokföring är exporterad som SIE av företaget. Ingen insyn i innehållet behövs.
 */
export async function adminDeleteCompany(fd: FormData) {
  const { adminEmail, company, path } = await companyTarget(fd);
  if (!company.lockedAt) backTo(path, "error", "Lås företaget först. Radering är bara möjlig för låsta företag.");
  if (str(fd, "confirmName").toLowerCase() !== company.name.trim().toLowerCase()) backTo(path, "error", "Företagsnamnet stämmer inte. Inget har tagits bort.");
  const b = await companyBookkeeping(company.id);
  if (b.blocked) backTo(path, "error", "Företaget har bokföring som inte är exporterad som SIE. Företagets ägare måste exportera alla räkenskapsår först.");
  const files = await companyFiles(company.id);
  await db.$transaction([
    ...companyPurgeOps(company.id),
    adminLogOp({ adminEmail, action: "company_deleted", targetType: "company", targetId: company.id, targetLabel: company.name, details: `${b.verifications} verifikationer, bokföringen var exporterad` }),
  ]);
  if (files) await deleteCompanyFiles(files);
  revalidatePath("/", "layout");
  backTo("/admin", "ok", `${company.name} är raderat.`);
}

// ---------------------------------------------------------------- Drift

export async function revokeGrantAdmin(fd: FormData) {
  const admin = await requireAdmin();
  const grant = await db.oAuthGrant.findUnique({
    where: { id: Number(str(fd, "grantId")) || -1 },
    include: { client: { select: { name: true } }, user: { select: { email: true } }, company: { select: { name: true } } },
  });
  if (!grant) backTo("/admin/connections", "error", "Kopplingen finns inte.");
  if (grant!.revokedAt) backTo("/admin/connections", "error", "Kopplingen är redan återkallad.");
  await revokeGrant(grant!.id);
  await adminLogOp({
    adminEmail: admin.user.email, action: "grant_revoked", targetType: "user", targetId: grant!.userId,
    targetLabel: grant!.user.email, details: `${grant!.client.name} → ${grant!.company.name}`,
  });
  backTo("/admin/connections", "ok", `Kopplingen för ${grant!.user.email} är återkallad.`);
}

export async function deleteOrphans() {
  const admin = await requireAdmin();
  const { orphans } = await findOrphans();
  let size = 0;
  for (const f of orphans) {
    await deleteStored({ storedName: f.pathname, blobUrl: f.blobUrl });
    size += f.size;
  }
  await adminLogOp({ adminEmail: admin.user.email, action: "orphans_deleted", targetType: "company", targetLabel: "Lagring", details: `${orphans.length} filer, ${(size / 1_048_576).toFixed(1)} MB` });
  backTo("/admin/storage", "ok", `${orphans.length} föräldralösa filer är borttagna.`);
}
