"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { AccountingError, bookWithTemplate } from "@/lib/accounting";
import { attempt, str, withParam } from "@/lib/action";
import { deleteStored } from "@/lib/storage";
import { parseDate, parseKr } from "@/lib/money";

export async function bookUpload(fd: FormData) {
  const { companyId } = await requireCompany();
  const id = Number(str(fd, "uploadId"));
  const v = await attempt(async () => {
    const date = parseDate(str(fd, "date"));
    const gross = parseKr(str(fd, "amount"));
    const templateId = Number(str(fd, "templateId"));
    if (!templateId) throw new AccountingError("Välj en bokföringsmall.");
    if (!date) throw new AccountingError("Ange ett giltigt datum.");
    if (!gross) throw new AccountingError("Ange belopp inklusive moms.");
    return bookWithTemplate(companyId, {
      uploadId: id,
      templateId,
      date,
      gross,
      paymentAccount: Number(str(fd, "paymentAccount")) || 1930,
      description: str(fd, "description"),
    });
  }, `/uploads/${id}`);
  redirect(`/verifications/${v.id}?ok=${encodeURIComponent(`Bokfört som ${v.series}${v.number}.`)}`);
}

export async function uploadAsExpense(fd: FormData) {
  const { companyId } = await requireCompany();
  const id = Number(str(fd, "uploadId"));
  const e = await attempt(async () => {
    const u = await db.upload.findFirst({ where: { id, companyId }, include: { expense: true } });
    if (!u || u.verificationId || u.expense) throw new AccountingError("Underlaget finns inte eller är redan hanterat.");
    const date = parseDate(str(fd, "date"));
    const amount = parseKr(str(fd, "amount"));
    if (!date || !amount) throw new AccountingError("Ange datum och belopp för utlägget.");
    return db.expense.create({
      data: {
        companyId,
        employee: str(fd, "employee") || "Okänd",
        date,
        amount,
        description: str(fd, "description") || "Utlägg",
        vatRate: Number(str(fd, "vatRate")) || 0,
        costAccount: Number(str(fd, "costAccount")) || 6991,
        uploadId: id,
      },
    });
  }, `/uploads/${id}?tab=expense`);
  revalidatePath("/", "layout");
  redirect(withParam("/expenses", "ok", `Utlägget "${e.description}" är registrerat och väntar på bokföring.`));
}

export async function deleteUpload(fd: FormData) {
  const { companyId } = await requireCompany();
  const id = Number(str(fd, "uploadId"));
  const u = await db.upload.findFirst({ where: { id, companyId }, include: { expense: true } });
  if (!u) redirect("/uploads");
  if (u.verificationId || u.expense) redirect(withParam(`/uploads/${id}`, "error", "Bokförda underlag kan inte tas bort (arkiveringsplikt)."));
  await db.upload.delete({ where: { id } });
  await deleteStored(u);
  revalidatePath("/", "layout");
  redirect(withParam("/uploads", "ok", "Underlaget togs bort."));
}
