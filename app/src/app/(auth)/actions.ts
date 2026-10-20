"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { endSession, getSession, hashPassword, requireUser, setActiveCompany, startSession, verifyPassword } from "@/lib/auth";
import { createCompany, isCompanyType, isVatPeriod, validOrgNumber } from "@/lib/company-setup";
import { str, withParam } from "@/lib/action";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function companyFields(fd: FormData) {
  return {
    name: str(fd, "companyName"),
    orgNumber: str(fd, "orgNumber"),
    vatNumber: str(fd, "vatNumber"),
    address: str(fd, "address"),
    postalCode: str(fd, "postalCode"),
    city: str(fd, "city"),
    email: str(fd, "companyEmail"),
    companyType: isCompanyType(str(fd, "companyType")) ? str(fd, "companyType") : "ab",
    vatPeriod: isVatPeriod(str(fd, "vatPeriod")) ? str(fd, "vatPeriod") : "quarter",
    fiscalStartMonth: Math.min(12, Math.max(1, Number(str(fd, "fiscalStartMonth")) || 1)),
  };
}

function companyError(c: { name: string; orgNumber: string }) {
  if (!c.name) return "Ange företagets namn.";
  if (!validOrgNumber(c.orgNumber)) return "Organisationsnumret är inte giltigt (format 556677-8899).";
  return null;
}

export type FormState = { error?: string; values?: Record<string, string> } | undefined;

const keep = (fd: FormData) =>
  Object.fromEntries([...fd.entries()].filter(([k, v]) => typeof v === "string" && k !== "password" && !k.startsWith("$")).map(([k, v]) => [k, String(v)]));

export async function register(_: FormState, fd: FormData): Promise<FormState> {
  const name = str(fd, "name");
  const email = str(fd, "email").toLowerCase();
  const password = String(fd.get("password") ?? "");
  const company = companyFields(fd);
  const fail = (error: string) => ({ error, values: keep(fd) });

  if (!name) return fail("Ange ditt namn.");
  if (!EMAIL.test(email)) return fail("Ange en giltig e-postadress.");
  if (password.length < 10) return fail("Lösenordet måste vara minst 10 tecken.");
  const cErr = companyError(company);
  if (cErr) return fail(cErr);
  if (await db.user.findUnique({ where: { email } })) return fail("Det finns redan ett konto med den e-postadressen. Logga in istället.");

  const passwordHash = await hashPassword(password);
  const { user, created } = await db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name, email, passwordHash } });
    const created = await createCompany(tx, user.id, { ...company, email: company.email || email });
    return { user, created };
  });
  await startSession(user.id, created.id);
  redirect("/?ok=" + encodeURIComponent(`Välkommen! ${created.name} är skapat med BAS-kontoplan och bokföringsmallar.`));
}

export async function login(fd: FormData) {
  const email = str(fd, "email").toLowerCase();
  const password = String(fd.get("password") ?? "");
  const user = await db.user.findUnique({ where: { email } });
  // Kör alltid hashjämförelsen så att svarstiden inte avslöjar om kontot finns.
  const ok = await verifyPassword(password, user?.passwordHash ?? "scrypt$00$00");
  if (!user || !ok) redirect(withParam("/login", "error", "Fel e-post eller lösenord."));
  const first = await db.membership.findFirst({ where: { userId: user.id }, orderBy: { companyId: "asc" } });
  await startSession(user.id, first?.companyId ?? null);
  const next = str(fd, "next");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}

export async function addCompany(_: FormState, fd: FormData): Promise<FormState> {
  const s = await requireUser();
  const company = companyFields(fd);
  const cErr = companyError(company);
  if (cErr) return { error: cErr, values: keep(fd) };
  const created = await db.$transaction((tx) => createCompany(tx, s.userId, company));
  await setActiveCompany(s.id, s.userId, created.id);
  revalidatePath("/", "layout");
  redirect("/?ok=" + encodeURIComponent(`${created.name} är skapat.`));
}

export async function switchCompany(fd: FormData) {
  const s = await getSession();
  if (!s) redirect("/login");
  await setActiveCompany(s.id, s.userId, Number(str(fd, "companyId")));
  revalidatePath("/", "layout");
  redirect("/");
}
