"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { AccountingError, createVerification, reverseVerification } from "@/lib/accounting";
import { attempt, str } from "@/lib/action";
import { parseDate, parseKr } from "@/lib/money";

export async function createManualVerification(fd: FormData) {
  const { companyId } = await requireCompany();
  const uploadId = parseInt(str(fd, "uploadId"), 10) || 0;
  const v = await attempt(
    () =>
      db.$transaction(async (tx) => {
        const date = parseDate(str(fd, "date"));
        if (!date) throw new AccountingError("Ange ett giltigt datum.");
        const raw = JSON.parse(str(fd, "lines") || "[]") as { account: string; debit: string; credit: string; text: string }[];
        const lines = raw.map((l, i) => {
          const account = parseInt(l.account, 10);
          const debit = parseKr(l.debit) ?? 0;
          const credit = parseKr(l.credit) ?? 0;
          if ((debit || credit) && !account) throw new AccountingError(`Rad ${i + 1} saknar konto.`);
          return { account, debit, credit, text: l.text ?? "" };
        });
        if (uploadId) {
          const u = await tx.upload.findFirst({ where: { id: uploadId, companyId } });
          if (!u || u.verificationId) throw new AccountingError("Underlaget finns inte eller är redan bokfört.");
        }
        const created = await createVerification(tx, companyId, { date, description: str(fd, "description"), lines });
        if (uploadId) await tx.upload.update({ where: { id: uploadId }, data: { verificationId: created.id } });
        return created;
      }),
    uploadId ? `/uploads/${uploadId}?tab=manual` : "/verifications/new",
  );
  redirect(`/verifications/${v.id}?ok=${encodeURIComponent(`Verifikat ${v.series}${v.number} bokfört.`)}`);
}

export async function reverse(fd: FormData) {
  const { companyId } = await requireCompany();
  const id = Number(str(fd, "id"));
  const rev = await attempt(() => reverseVerification(companyId, id), `/verifications/${id}`);
  redirect(`/verifications/${rev.id}?ok=${encodeURIComponent("Verifikatet är makulerat med ett omvänt verifikat.")}`);
}
