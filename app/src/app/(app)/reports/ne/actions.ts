"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWriter } from "@/lib/auth";
import { str, withParam } from "@/lib/action";
import { NE_CODES, NE_FROM, NE_NONE, NE_TO } from "@/lib/ne";

/** Kopplar om ett konto i NE-underlaget. Fältet "default" tar bort den egna kopplingen. */
export async function setNeMapping(fd: FormData) {
  const { companyId } = await requireWriter();
  const account = Number(str(fd, "account"));
  const field = str(fd, "field");
  const fy = str(fd, "fy");
  const back = (key: "ok" | "error", msg: string): never => redirect(withParam(`/reports/ne${fy ? `?fy=${encodeURIComponent(fy)}` : ""}`, key, msg));
  if (!Number.isInteger(account) || account < NE_FROM || account > NE_TO) back("error", "Kontot kan inte kopplas till NE-bilagan.");
  if (field === "default") {
    await db.neMapping.deleteMany({ where: { companyId, account } });
    revalidatePath("/reports/ne");
    back("ok", `Konto ${account} använder standardkopplingen.`);
  }
  if (field !== NE_NONE && !(NE_CODES as string[]).includes(field)) back("error", "Ogiltigt fält.");
  await db.neMapping.upsert({ where: { companyId_account: { companyId, account } }, create: { companyId, account, field }, update: { field } });
  revalidatePath("/reports/ne");
  back("ok", field === NE_NONE ? `Konto ${account} lämnas utanför NE-bilagan.` : `Konto ${account} räknas nu till ${field}.`);
}
