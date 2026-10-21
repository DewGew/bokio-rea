"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWriter } from "@/lib/auth";
import { str } from "@/lib/action";
import { isCompanyType, isVatPeriod } from "@/lib/company-setup";
import { addMonths, fiscalYears, fyLabel, monthsBetween } from "@/lib/fiscal";
import { parseDate } from "@/lib/money";

export type SettingsState = { ok?: string; error?: string } | undefined;

const done = (ok: string): SettingsState => {
  revalidatePath("/", "layout");
  return { ok };
};

/** Företagsform, bokföringsmetod och moms. */
export async function saveTaxSettings(_: SettingsState, fd: FormData): Promise<SettingsState> {
  const { companyId, company } = await requireWriter();
  const companyType = str(fd, "companyType");
  const accountingMethod = str(fd, "accountingMethod");
  const vatPeriod = str(fd, "vatPeriod");
  const fiscalStartMonth = Number(str(fd, "fiscalStartMonth"));

  if (!isCompanyType(companyType)) return { error: "Välj företagsform." };
  if (!["invoice", "cash"].includes(accountingMethod)) return { error: "Välj bokföringsmetod." };
  if (!isVatPeriod(vatPeriod)) return { error: "Välj momsredovisning." };
  if (!(fiscalStartMonth >= 1 && fiscalStartMonth <= 12)) return { error: "Välj startmånad för räkenskapsåret." };
  if (companyType === "ef" && fiscalStartMonth !== 1) return { error: "En enskild firma har kalenderår som räkenskapsår (januari–december)." };

  // Byte av bokföringsmetod med obetalda fakturor skulle blanda metoderna för samma faktura.
  if (accountingMethod !== company.accountingMethod) {
    const unpaid = await db.invoice.count({ where: { companyId, status: "sent" } });
    if (unpaid) return { error: `Du har ${unpaid} obetalda fakturor. Registrera betalning eller kreditera dem innan du byter bokföringsmetod.` };
  }

  await db.company.update({
    where: { id: companyId },
    data: { companyType, accountingMethod, vatPeriod, euTrade: fd.get("euTrade") === "on", fiscalStartMonth },
  });
  return done("Inställningarna är sparade.");
}

/** Ändrar start/slut för ett räkenskapsår (t.ex. förlängt eller förkortat första år). */
async function updateFiscalYear(fd: FormData): Promise<SettingsState> {
  const { companyId } = await requireWriter();
  const id = Number(str(fd, "id"));
  const start = parseDate(str(fd, "start"));
  const end = parseDate(str(fd, "end"));
  const all = await fiscalYears(companyId);
  const i = all.findIndex((f) => f.id === id);
  const fy = all[i];
  if (!fy) return { error: "Räkenskapsåret finns inte." };
  if (fy.closedAt) return { error: "Ett stängt räkenskapsår kan inte ändras." };
  if (!start || !end) return { error: "Ange start- och slutdatum." };
  if (start.getUTCDate() !== 1) return { error: "Räkenskapsåret måste börja den första dagen i en månad." };
  if (addMonths(end, 1).getTime() - 86400000 !== end.getTime()) return { error: "Räkenskapsåret måste sluta den sista dagen i en månad." };
  const months = monthsBetween(start, end);
  if (months < 1 || months > 18) return { error: "Ett räkenskapsår får vara högst 18 månader (förlängt första år) och minst en månad." };

  // Räkenskapsåren måste följa på varandra utan luckor.
  const prev = all[i - 1];
  const next = all[i + 1];
  if (prev && start.getTime() !== prev.end.getTime() + 86400000) return { error: `Startdatumet måste vara dagen efter föregående år (${fyLabel(prev)}).` };
  if (next && end.getTime() !== next.start.getTime() - 86400000) return { error: `Slutdatumet måste vara dagen före nästa år (${fyLabel(next)}).` };

  const outside = await db.verification.count({ where: { fiscalYearId: id, OR: [{ date: { lt: start } }, { date: { gt: end } }] } });
  if (outside) return { error: `${outside} verifikat i räkenskapsåret skulle hamna utanför de nya datumen.` };
  const lockedVat = await db.vatPeriod.count({ where: { companyId, lockedAt: { not: null }, OR: [{ start: { lt: start }, end: { gte: fy.start } }, { end: { gt: end }, start: { lte: fy.end } }] } });
  if (lockedVat) return { error: "Det finns låsta momsperioder som påverkas av ändringen." };

  await db.fiscalYear.update({ where: { id }, data: { start, end } });
  return done(`Räkenskapsåret är ändrat till ${fyLabel({ start, end })}.`);
}

/** Skapar nästa räkenskapsår (12 månader direkt efter det senaste). */
async function addFiscalYear(): Promise<SettingsState> {
  const { companyId } = await requireWriter();
  const all = await fiscalYears(companyId);
  const last = all[all.length - 1];
  if (!last) return { error: "Det finns inget räkenskapsår att fortsätta från." };
  const start = addMonths(last.end, 1);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 12, 0));
  await db.fiscalYear.create({ data: { companyId, start, end } });
  return done(`Räkenskapsåret ${fyLabel({ start, end })} är skapat.`);
}

/** Tar bort det senaste räkenskapsåret om det är tomt. */
async function removeFiscalYear(fd: FormData): Promise<SettingsState> {
  const { companyId } = await requireWriter();
  const all = await fiscalYears(companyId);
  const last = all[all.length - 1];
  if (!last || last.id !== Number(str(fd, "id")) || all.length === 1) return { error: "Bara det senaste räkenskapsåret kan tas bort, och minst ett måste finnas." };
  if (await db.verification.count({ where: { fiscalYearId: last.id } })) return { error: "Räkenskapsåret har verifikat och kan inte tas bort." };
  await db.fiscalYear.delete({ where: { id: last.id } });
  return done("Räkenskapsåret är borttaget.");
}

/** Alla ändringar av räkenskapsår går via en åtgärd; formulären anger vad som ska göras i fältet "intent". */
export async function fiscalYearAction(_: SettingsState, fd: FormData): Promise<SettingsState> {
  switch (str(fd, "intent")) {
    case "update":
      return updateFiscalYear(fd);
    case "add":
      return addFiscalYear();
    case "remove":
      return removeFiscalYear(fd);
    default:
      return { error: "Okänd åtgärd." };
  }
}
