"use server";

import { redirect } from "next/navigation";
import { requireWriter } from "@/lib/auth";
import { AccountingError } from "@/lib/accounting";
import { attempt, str, withParam } from "@/lib/action";
import { closeFiscalYear, reopenFiscalYear, saveOpeningBalances } from "@/lib/closing";
import { parseKr } from "@/lib/money";

export async function closeYearAction(fd: FormData) {
  const { companyId } = await requireWriter();
  const id = Number(str(fd, "id"));
  const back = `/closing/${id}`;
  const taxInput = str(fd, "tax");
  const r = await attempt(async () => {
    const tax = taxInput === "" ? undefined : parseKr(taxInput);
    if (tax === null || (tax !== undefined && tax < 0)) throw new AccountingError("Ange skatten som ett belopp i kronor.");
    return closeFiscalYear(companyId, id, tax);
  }, back);
  redirect(withParam(back, "ok", `Bokslutet är bokfört (${r.ids.length} verifikat) och räkenskapsåret är stängt.`));
}

export async function reopenYearAction(fd: FormData) {
  const { companyId } = await requireWriter();
  const id = Number(str(fd, "id"));
  const back = `/closing/${id}`;
  await attempt(() => reopenFiscalYear(companyId, id), back);
  redirect(withParam(back, "ok", "Bokslutet är ångrat: bokslutsverifikaten är makulerade och året är öppet igen."));
}

export async function saveOpeningBalancesAction(fd: FormData) {
  const { companyId } = await requireWriter();
  const back = "/closing/opening-balances";
  await attempt(async () => {
    const raw = JSON.parse(str(fd, "rows") || "[]") as { account: string; amount: string }[];
    const rows = raw
      .filter((r) => r.account.trim() || r.amount.trim())
      .map((r, i) => {
        const account = parseInt(r.account, 10);
        const amount = parseKr(r.amount);
        if (!account) throw new AccountingError(`Rad ${i + 1} saknar konto.`);
        if (amount === null) throw new AccountingError(`Rad ${i + 1} har ogiltigt belopp.`);
        return { account, amount };
      });
    return saveOpeningBalances(companyId, rows);
  }, back);
  redirect(withParam(back, "ok", "De ingående balanserna är sparade."));
}
