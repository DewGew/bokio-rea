"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { AccountingError, bookExpense, payExpenses } from "@/lib/accounting";
import { attempt, str, withParam } from "@/lib/action";
import { parseDate, parseKr } from "@/lib/money";

export async function createExpense(fd: FormData) {
  const { companyId } = await requireCompany();
  await attempt(async () => {
    const date = parseDate(str(fd, "date"));
    const amount = parseKr(str(fd, "amount"));
    if (!date) throw new AccountingError("Ange ett giltigt datum.");
    if (!amount || amount <= 0) throw new AccountingError("Ange ett belopp större än noll.");
    const costAccount = Number(str(fd, "costAccount")) || 6991;
    if (!(await db.account.findUnique({ where: { companyId_number: { companyId, number: costAccount } } }))) {
      throw new AccountingError(`Kontot ${costAccount} finns inte.`);
    }
    return db.expense.create({
      data: {
        companyId,
        employee: str(fd, "employee"),
        date,
        description: str(fd, "description"),
        amount,
        vatRate: Number(str(fd, "vatRate")) || 0,
        costAccount,
      },
    });
  }, "/expenses");
  redirect(withParam("/expenses", "ok", "Utlägget är registrerat."));
}

export async function bookExpenseAction(fd: FormData) {
  const { companyId } = await requireCompany();
  await attempt(() => bookExpense(companyId, Number(str(fd, "id"))), "/expenses");
  redirect(withParam("/expenses", "ok", "Utlägget är bokfört som skuld till den anställde."));
}

export async function payExpensesAction(fd: FormData) {
  const { companyId } = await requireCompany();
  const ids = fd.getAll("ids").map(Number).filter(Boolean);
  const v = await attempt(async () => {
    const date = parseDate(str(fd, "date"));
    if (!date) throw new AccountingError("Ange utbetalningsdatum.");
    if (ids.length === 0) throw new AccountingError("Markera vilka utlägg som ska betalas ut.");
    return payExpenses(companyId, ids, date);
  }, "/expenses");
  redirect(withParam("/expenses", "ok", `Utbetalningen är bokförd som ${v.series}${v.number}.`));
}

export async function deleteExpense(fd: FormData) {
  const { companyId } = await requireCompany();
  await db.expense.deleteMany({ where: { id: Number(str(fd, "id")), companyId, status: "pending" } });
  redirect(withParam("/expenses", "ok", "Utlägget är borttaget."));
}
