"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWriter } from "@/lib/auth";
import { str, withParam } from "@/lib/action";
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
  const showOcr = fd.get("showOcr") === "on";
  if (showOcr && !str(fd, "bankgiro") && !str(fd, "plusgiro")) return { error: "OCR-nummer kräver bankgiro eller plusgiro. Fyll i något av dem, eller stäng av OCR-numret." };
  if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return { error: "IBAN ser inte giltigt ut (t.ex. SE45 5000 0000 0583 9825 7466)." };

  await db.company.update({
    where: { id: companyId },
    data: {
      invoiceTemplate: template,
      invoiceColor: color.toLowerCase(),
      invoiceFooter: str(fd, "footer").slice(0, 300),
      swishNumber: swish ? swishDigits(swish) : "",
      showOcr,
      swishQr: fd.get("swishQr") === "on" && !!swish,
      paymentLink: link ? safeLink(link) : "",
      bankgiro: str(fd, "bankgiro"),
      plusgiro: str(fd, "plusgiro"),
      bankName: str(fd, "bankName").slice(0, 60),
      bankAccount: str(fd, "bankAccount").slice(0, 60),
      iban: iban.replace(/(.{4})/g, "$1 ").trim(),
      bic: str(fd, "bic").toUpperCase(),
      phone: str(fd, "phone"),
      website: str(fd, "website"),
    },
  });
  revalidatePath("/", "layout");
  return { ok: "Fakturadesignen är sparad och används för alla fakturor." };
}

/**
 * Väljer vilket nummer fakturorna ska börja på. Bara möjligt innan den första fakturan (eller kreditfakturan) har utfärdats:
 * fakturanummer ska vara löpande och unika, så en befintlig serie får inte hoppa eller börja om.
 */
export async function setStartInvoiceNumber(fd: FormData) {
  const { companyId } = await requireWriter();
  const raw = str(fd, "start");
  const n = Number(raw);
  const back = (key: "ok" | "error", msg: string): never => redirect(withParam("/invoices/design", key, msg));
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < 1 || n > 99_999_999) back("error", "Ange ett heltal mellan 1 och 99 999 999.");
  const done = await db.$transaction(async (tx) => {
    if ((await tx.invoice.count({ where: { companyId, number: { not: null } } })) > 0) return false;
    await tx.company.update({ where: { id: companyId }, data: { invoiceCounter: n - 1 } });
    return true;
  });
  if (!done) back("error", "Numreringen kan inte ändras efter att den första fakturan har utfärdats.");
  revalidatePath("/invoices", "layout");
  back("ok", `Nästa faktura får nummer ${n}.`);
}
