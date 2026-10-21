"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/auth";
import { db } from "@/lib/db";
import { AccountingError } from "@/lib/accounting";
import { attempt } from "@/lib/action";
import { BankCsvError, decodeCsv, parseBankCsv, type BankRow, type Mapping } from "@/lib/bank-csv";
import { autoBook, bookMany, importBankRows, parseChoice, undoBankTransaction, type Choice } from "@/lib/bank";

export type BankImportState =
  | {
      step: "plan";
      fileName: string;
      bank: string;
      headers: string[];
      mapping: Mapping;
      sample: BankRow[];
      count: number;
      fresh: number;
      duplicates: number;
      from: string;
      to: string;
      warnings: string[];
    }
  | { step: "done"; created: number; duplicates: number; booked: number; failed: number }
  | { step: "error"; error: string }
  | undefined;

const MAX = 4 * 1024 * 1024;
const MAPPING_KEYS = ["date", "amount", "text", "reference", "balance", "credit"] as const;

/** Steg 1: läs filen och visa vad som hittats. Steg 2 (confirm): importera och bokför säkra förslag. */
export async function bankImportAction(_: BankImportState, fd: FormData): Promise<BankImportState> {
  const { companyId } = await requireCompany();
  if (fd.get("reset") === "1") return undefined;
  try {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new BankCsvError("Välj en CSV-fil från banken.");
    if (file.size > MAX) throw new BankCsvError("Filen är större än 4 MB. Exportera en kortare period.");
    const bankAccount = Number(fd.get("bankAccount")) || 1930;
    const account = await db.account.findFirst({ where: { companyId, number: bankAccount } });
    if (!account || bankAccount < 1900 || bankAccount > 1999) throw new BankCsvError("Välj ett bankkonto (19xx) som finns i kontoplanen.");

    const override: Partial<Mapping> = {};
    for (const k of MAPPING_KEYS) {
      const v = fd.get(`m_${k}`);
      if (typeof v === "string" && v !== "") override[k] = Number(v);
    }
    const parsed = parseBankCsv(decodeCsv(new Uint8Array(await file.arrayBuffer())), { override, invert: fd.get("invert") === "on" });

    if (fd.get("confirm") !== "1") {
      const dry = await importBankRows(companyId, bankAccount, parsed.rows, { dryRun: true });
      const dates = parsed.rows.map((r) => r.date).sort();
      return {
        step: "plan",
        fileName: file.name,
        bank: parsed.bank,
        headers: parsed.headers,
        mapping: parsed.mapping,
        sample: parsed.rows.slice(0, 6),
        count: parsed.rows.length,
        fresh: dry.fresh,
        duplicates: dry.duplicates,
        from: dates[0],
        to: dates[dates.length - 1],
        warnings: parsed.warnings,
      };
    }

    const result = await importBankRows(companyId, bankAccount, parsed.rows);
    const auto = fd.get("autoBook") === "on" ? await autoBook(companyId, result.created) : { booked: 0, failed: [] };
    revalidatePath("/", "layout");
    return { step: "done", created: result.created.length, duplicates: result.duplicates, booked: auto.booked, failed: auto.failed.length };
  } catch (e) {
    if (e instanceof BankCsvError || e instanceof AccountingError) return { step: "error", error: e.message };
    throw e;
  }
}

export type BookResult = { booked: number; failed: { id: number; error: string }[] };

/** Bokför valda transaktioner (anropas direkt från listan). */
export async function bookBankAction(items: { id: number; choice: Choice }[]): Promise<BookResult> {
  const { companyId } = await requireCompany();
  const valid = items.flatMap((it) => {
    const choice = parseChoice(it.choice);
    return Number.isInteger(it.id) && choice ? [{ id: it.id, choice }] : [];
  });
  const result = await bookMany(companyId, valid.slice(0, 500));
  revalidatePath("/", "layout");
  return result;
}

export async function ignoreBankAction(ids: number[]) {
  const { companyId } = await requireCompany();
  await db.bankTransaction.updateMany({ where: { companyId, id: { in: ids.filter(Number.isInteger) }, status: "new" }, data: { status: "ignored" } });
  revalidatePath("/", "layout");
}

export async function restoreBankAction(fd: FormData) {
  const { companyId } = await requireCompany();
  await db.bankTransaction.updateMany({ where: { companyId, id: Number(fd.get("id")) || -1, status: "ignored" }, data: { status: "new" } });
  revalidatePath("/", "layout");
}

export async function undoBankAction(fd: FormData) {
  const { companyId } = await requireCompany();
  await attempt(() => undoBankTransaction(companyId, Number(fd.get("id")) || -1), "/bank?tab=booked");
}
