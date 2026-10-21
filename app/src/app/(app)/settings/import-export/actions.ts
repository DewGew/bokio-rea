"use server";

import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/auth";
import { AccountingError } from "@/lib/accounting";
import { SieError, decodeSie, parseSie } from "@/lib/sie";
import { planImport, runImport, type ImportPlan } from "@/lib/sie-import";

export type ImportState =
  | { step: "plan"; plan: ImportPlan; fileName: string }
  | { step: "done"; result: Awaited<ReturnType<typeof runImport>> }
  | { step: "error"; error: string }
  | undefined;

const MAX = 4 * 1024 * 1024;

async function readFile(fd: FormData) {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) throw new SieError("Välj en SIE-fil (.se eller .si).");
  if (file.size > MAX) throw new SieError("Filen är större än 4 MB.");
  return { sie: parseSie(decodeSie(new Uint8Array(await file.arrayBuffer()))), name: file.name };
}

/** Steg 1: läs in filen och visa vad som kommer att hända. Steg 2 (confirm): importera. */
export async function sieImportAction(_: ImportState, fd: FormData): Promise<ImportState> {
  const { companyId } = await requireCompany();
  if (fd.get("reset") === "1") return undefined;
  try {
    const { sie, name } = await readFile(fd);
    if (fd.get("confirm") !== "1") {
      return { step: "plan", plan: await planImport(companyId, sie), fileName: name };
    }
    const result = await runImport(companyId, sie, {
      accounts: fd.get("optAccounts") === "on",
      openingBalances: fd.get("optIb") === "on",
      verifications: fd.get("optVers") === "on",
      lockVat: fd.get("optVat") === "on",
      closeYear: fd.get("optClose") === "on",
    });
    revalidatePath("/", "layout");
    return { step: "done", result };
  } catch (e) {
    if (e instanceof SieError || e instanceof AccountingError) return { step: "error", error: e.message };
    throw e;
  }
}
