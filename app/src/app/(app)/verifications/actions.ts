"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWriter } from "@/lib/auth";
import { AccountingError, createVerification, reverseVerification } from "@/lib/accounting";
import { attempt, str } from "@/lib/action";
import { parseDate, parseKr } from "@/lib/money";

export async function createManualVerification(fd: FormData) {
  const { companyId } = await requireWriter();
  const uploadId = parseInt(str(fd, "uploadId"), 10) || 0;
  // Underlag kan komma från en uppladdning (uploadId) eller bifogas direkt i formuläret (uploadIds).
  const uploadIds = [...new Set([uploadId, ...str(fd, "uploadIds").split(",").map((x) => parseInt(x, 10))].filter((x) => x > 0))];
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
        if (uploadIds.length) {
          const found = await tx.upload.findMany({ where: { id: { in: uploadIds }, companyId, verificationId: null } });
          if (found.length !== uploadIds.length) throw new AccountingError("Något underlag finns inte eller är redan bokfört.");
        }
        const created = await createVerification(tx, companyId, { date, description: str(fd, "description"), lines });
        if (uploadIds.length) await tx.upload.updateMany({ where: { id: { in: uploadIds } }, data: { verificationId: created.id } });
        return created;
      }),
    uploadId ? `/uploads/${uploadId}?tab=manual` : "/verifications/new",
  );
  redirect(`/verifications/${v.id}?ok=${encodeURIComponent(`Verifikat ${v.series}${v.number} bokfört.`)}`);
}

export async function reverse(fd: FormData) {
  const { companyId } = await requireWriter();
  const id = Number(str(fd, "id"));
  const rev = await attempt(() => reverseVerification(companyId, id), `/verifications/${id}`);
  redirect(`/verifications/${rev.id}?ok=${encodeURIComponent("Verifikatet är makulerat med ett omvänt verifikat.")}`);
}
