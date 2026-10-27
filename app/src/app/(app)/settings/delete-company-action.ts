"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { str, withParam } from "@/lib/action";
import { CompanyDeleteError, deleteCompany } from "@/lib/company-delete";

export async function deleteCompanyAction(fd: FormData) {
  const { companyId, user, role, session } = await requireCompany();
  let next: number;
  try {
    next = await deleteCompany({ companyId, userId: user.id, role, confirmName: str(fd, "confirmName") });
  } catch (e) {
    if (e instanceof CompanyDeleteError) redirect(withParam("/settings", "error", e.message));
    throw e;
  }
  await db.session.update({ where: { id: session.id }, data: { activeCompanyId: next } });
  revalidatePath("/", "layout");
  redirect(withParam("/", "ok", "Företaget är borttaget."));
}
