"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, verifyPassword } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { withParam } from "@/lib/action";
import { disableMfa, logMfaFailure, mfaAvailable, confirmSetup, regenerateRecoveryCodes, startSetup, tooManyMfaFailures, verifyUserCode } from "@/lib/mfa";

export type CodesState = { codes?: string[]; error?: string } | undefined;

const PAGE = "/settings/account/mfa";
const back = (key: "ok" | "error", msg: string): never => redirect(withParam(PAGE, key, msg));
const field = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");

const BUSY = "För många felaktiga koder. Vänta en kvart och försök igen.";

export async function startMfaSetup() {
  const { user } = await requireUser();
  if (!mfaAvailable()) back("error", "Tvåfaktorsinloggning är inte konfigurerad på servern.");
  if (user.mfaEnabledAt) back("error", "Tvåfaktorsinloggning är redan påslagen.");
  await startSetup(user.id);
  redirect(PAGE);
}

/** Avbryter en påbörjad aktivering. */
export async function cancelMfaSetup() {
  const { user } = await requireUser();
  if (!user.mfaEnabledAt) await disableMfa(user.id);
  redirect(PAGE);
}

export async function confirmMfaSetup(_: CodesState, fd: FormData): Promise<CodesState> {
  const { user } = await requireUser();
  if (user.mfaEnabledAt) return { error: "Tvåfaktorsinloggning är redan påslagen." };
  if (await tooManyMfaFailures(user.id)) return { error: BUSY };
  const codes = await confirmSetup(user.id, field(fd, "code"));
  if (!codes) {
    await logMfaFailure(user.id);
    return { error: "Fel kod. Kontrollera att du skannade rätt konto och att telefonens klocka går rätt." };
  }
  revalidatePath("/", "layout");
  return { codes };
}

export async function regenerateCodes(_: CodesState, fd: FormData): Promise<CodesState> {
  const { user } = await requireUser();
  if (!user.mfaEnabledAt) return { error: "Tvåfaktorsinloggning är inte påslagen." };
  if (await tooManyMfaFailures(user.id)) return { error: BUSY };
  if (!(await verifyUserCode(user.id, field(fd, "code")))) {
    await logMfaFailure(user.id);
    return { error: "Fel kod. Inga nya återställningskoder har skapats." };
  }
  return { codes: await regenerateRecoveryCodes(user.id) };
}

export async function disableMfaAction(fd: FormData) {
  const { user } = await requireUser();
  if (!user.mfaEnabledAt) back("error", "Tvåfaktorsinloggning är inte påslagen.");
  if (isAdminEmail(user.email)) back("error", "Administratörer måste ha tvåfaktorsinloggning och kan inte stänga av den.");
  if (await tooManyMfaFailures(user.id)) back("error", BUSY);
  if (!(await verifyPassword(field(fd, "password"), user.passwordHash)) || !(await verifyUserCode(user.id, field(fd, "code")))) {
    await logMfaFailure(user.id);
    back("error", "Lösenordet eller koden stämmer inte. Inget har ändrats.");
  }
  await disableMfa(user.id);
  revalidatePath("/", "layout");
  back("ok", "Tvåfaktorsinloggning är avstängd.");
}
