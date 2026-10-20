"use server";

import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { attempt, str, withParam } from "@/lib/action";
import { parseDate } from "@/lib/money";
import { closeVatPeriod, quarterOf } from "@/lib/vat";

export async function lockPeriod(fd: FormData) {
  const { companyId } = await requireCompany();
  const start = parseDate(str(fd, "start"));
  if (!start) redirect("/vat");
  const q = quarterOf(start);
  const back = `/vat/${str(fd, "start")}`;
  await attempt(() => closeVatPeriod(companyId, q.start, q.end), back);
  redirect(withParam(back, "ok", "Perioden är avstämd och låst. Momsen är flyttad till 2650."));
}
