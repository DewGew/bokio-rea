"use server";

import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { AccountingError, bookWithTemplate } from "@/lib/accounting";
import { attempt, str } from "@/lib/action";
import { parseDate, parseKr } from "@/lib/money";
import type { Country } from "@/lib/template-lines";

/** Steg 3 i bokföringsguiden: bokför med vald mall. Raderna räknas om på servern, klientens förhandsvisning litas inte på. */
export async function bookTemplateAction(fd: FormData) {
  const { companyId } = await requireCompany();
  const back = str(fd, "back") || "/verifications/new";
  const v = await attempt(async () => {
    const templateId = Number(str(fd, "templateId"));
    const date = parseDate(str(fd, "date"));
    const gross = parseKr(str(fd, "gross"));
    const country = (["se", "eu", "world"].includes(str(fd, "country")) ? str(fd, "country") : "se") as Country;
    if (!templateId) throw new AccountingError("Välj en mall.");
    if (!date) throw new AccountingError("Ange betaldatum.");
    if (!gross || gross <= 0) throw new AccountingError("Ange summan inklusive moms.");
    return bookWithTemplate(companyId, {
      templateId,
      date,
      gross,
      country,
      paymentAccount: Number(str(fd, "payAccount")) || 1930,
      description: str(fd, "title"),
      comment: str(fd, "comment"),
      uploadIds: str(fd, "uploadIds").split(",").map(Number).filter((n) => n > 0),
    });
  }, back);
  redirect(`/verifications/${v.id}?ok=${encodeURIComponent(`Verifikat ${v.series}${v.number} bokfört.`)}`);
}
