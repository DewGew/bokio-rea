"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWriter } from "@/lib/auth";
import { str } from "@/lib/action";

// Bara gemener och siffror: vissa e-postsystem gör om adressens första del till gemener.
const newToken = () => randomBytes(12).toString("hex");

function done(msg: string): never {
  revalidatePath("/settings/inbox");
  redirect(`/settings/inbox?ok=${encodeURIComponent(msg)}`);
}

export async function createInboxAction() {
  const { companyId, company } = await requireWriter();
  if (!company.inboxToken) await db.company.update({ where: { id: companyId }, data: { inboxToken: newToken() } });
  done("Kvittoadressen är skapad.");
}

/** Ny adress: den gamla slutar fungera direkt (t.ex. om den börjat få skräppost). */
export async function regenerateInboxAction() {
  const { companyId } = await requireWriter();
  await db.company.update({ where: { id: companyId }, data: { inboxToken: newToken() } });
  done("Du har fått en ny adress. Den gamla tar inte längre emot kvitton – uppdatera dina regler för vidarebefordran.");
}

export async function saveSendersAction(fd: FormData) {
  const { companyId } = await requireWriter();
  const list = str(fd, "senders")
    .split(/[\n,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 100);
  const invalid = list.find((s) => !/^@?[a-z0-9._%+-]*@?[a-z0-9.-]+\.[a-z]{2,}$/.test(s));
  if (invalid) redirect(`/settings/inbox?error=${encodeURIComponent(`"${invalid}" är varken en e-postadress eller en domän.`)}`);
  await db.company.update({ where: { id: companyId }, data: { inboxAllowedSenders: list.join("\n") } });
  done(list.length ? "Bara de angivna avsändarna tas emot." : "Kvitton från alla avsändare tas emot.");
}
