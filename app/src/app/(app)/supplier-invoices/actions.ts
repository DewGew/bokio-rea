"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWriter } from "@/lib/auth";
import { AccountingError, bookSupplierInvoice, paySupplierInvoice } from "@/lib/accounting";
import { attempt, str, withParam } from "@/lib/action";
import { parseDate, parseKr } from "@/lib/money";

export async function createSupplierInvoice(fd: FormData) {
  const { companyId } = await requireWriter();
  const invoice = await attempt(async () => {
    const supplierName = str(fd, "supplier").trim().slice(0, 160);
    const invoiceNumber = str(fd, "invoiceNumber").trim().slice(0, 80);
    const date = parseDate(str(fd, "date"));
    const dueDate = parseDate(str(fd, "dueDate"));
    const amount = parseKr(str(fd, "amount"));
    const vatAmount = parseKr(str(fd, "vatAmount")) ?? 0;
    const costAccount = Number(str(fd, "costAccount")) || 6991;
    const uploadId = Number(str(fd, "uploadId")) || null;
    if (!supplierName || !invoiceNumber) throw new AccountingError("Ange leverantör och fakturanummer.");
    if (!date || !dueDate) throw new AccountingError("Ange fakturadatum och förfallodatum.");
    if (!amount || amount <= 0 || vatAmount < 0 || vatAmount > amount) throw new AccountingError("Kontrollera belopp och moms.");
    const account = await db.account.findUnique({ where: { companyId_number: { companyId, number: costAccount } } });
    if (!account) throw new AccountingError("Kostnadskontot finns inte i kontoplanen.");
    if (uploadId) {
      const upload = await db.upload.findFirst({ where: { id: uploadId, companyId, verificationId: null, expense: null, supplierInvoice: null } });
      if (!upload) throw new AccountingError("Bilagan finns inte eller används redan.");
    }
    return db.$transaction(async (tx) => {
      const supplier = await tx.supplier.upsert({
        where: { companyId_name: { companyId, name: supplierName } },
        create: { companyId, name: supplierName, orgNumber: str(fd, "supplierOrgNumber").slice(0, 40) },
        update: { orgNumber: str(fd, "supplierOrgNumber").slice(0, 40) || undefined },
      });
      return tx.supplierInvoice.create({
        data: { companyId, supplierId: supplier.id, invoiceNumber, date, dueDate, amount, vatAmount, costAccount, description: str(fd, "description").slice(0, 200), uploadId },
      });
    });
  }, "/supplier-invoices/new");
  redirect(withParam("/supplier-invoices", "ok", `Leverantörsfaktura ${invoice.invoiceNumber} registrerad.`));
}

export async function bookSupplierInvoiceAction(fd: FormData) {
  const { companyId } = await requireWriter();
  const id = Number(str(fd, "id"));
  const v = await attempt(() => bookSupplierInvoice(companyId, id), "/supplier-invoices");
  redirect(withParam("/supplier-invoices", "ok", `Fakturan bokfördes som ${v.series}${v.number}.`));
}

export async function paySupplierInvoiceAction(fd: FormData) {
  const { companyId } = await requireWriter();
  const id = Number(str(fd, "id"));
  const date = parseDate(str(fd, "date"));
  if (!date) redirect(withParam("/supplier-invoices", "error", "Ange betalningsdatum."));
  const v = await attempt(() => paySupplierInvoice(companyId, id, date), "/supplier-invoices");
  redirect(withParam("/supplier-invoices", "ok", `Betalningen bokfördes som ${v.series}${v.number}.`));
}
