"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWriter } from "@/lib/auth";
import { str } from "@/lib/action";
import { isTemplate, safeLink, swishDigits, validHex, validSwish } from "@/lib/invoice-design";

export type DesignState = { ok?: string; error?: string } | undefined;

export async function saveInvoiceDesign(_: DesignState, fd: FormData): Promise<DesignState> {
  const { companyId } = await requireWriter();
  const template = str(fd, "template");
  const color = str(fd, "color");
  const swish = str(fd, "swishNumber");
  const link = str(fd, "paymentLink");
  const iban = str(fd, "iban").replace(/\s/g, "").toUpperCase();

  if (!isTemplate(template)) return { error: "Välj en mall." };
  if (!validHex(color)) return { error: "Färgen måste anges som hex, t.ex. #0071e3." };
  if (swish && !validSwish(swish)) return { error: "Swish-numret ska vara ett företagsnummer (123 xxx xx xx) eller ett mobilnummer (07x)." };
  if (link && !safeLink(link)) return { error: "Betallänken måste börja med https://." };
  if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return { error: "IBAN ser inte giltigt ut (t.ex. SE45 5000 0000 0583 9825 7466)." };

  await db.company.update({
    where: { id: companyId },
    data: {
      invoiceTemplate: template,
      invoiceColor: color.toLowerCase(),
      invoiceFooter: str(fd, "footer").slice(0, 300),
      swishNumber: swish ? swishDigits(swish) : "",
      swishQr: fd.get("swishQr") === "on" && !!swish,
      paymentLink: link ? safeLink(link) : "",
      bankgiro: str(fd, "bankgiro"),
      plusgiro: str(fd, "plusgiro"),
      iban: iban.replace(/(.{4})/g, "$1 ").trim(),
      bic: str(fd, "bic").toUpperCase(),
      phone: str(fd, "phone"),
      website: str(fd, "website"),
    },
  });
  revalidatePath("/", "layout");
  return { ok: "Fakturadesignen är sparad och används för alla fakturor." };
}
