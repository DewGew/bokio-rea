"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/auth";
import { currentFiscalYear, fiscalYears } from "@/lib/fiscal";
import { fyCookieName } from "@/lib/fiscal-select";

/** Byter vilket räkenskapsår hela appen visar. Det aktuella året är standard och lagras inte. */
export async function switchFiscalYear(fd: FormData) {
  const { companyId } = await requireCompany();
  const id = Number(fd.get("fyId"));
  const [all, current] = await Promise.all([fiscalYears(companyId), currentFiscalYear(companyId)]);
  if (!all.some((y) => y.id === id)) return;
  const jar = await cookies();
  const name = fyCookieName(companyId);
  if (id === current.id) jar.delete(name);
  else jar.set(name, String(id), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
