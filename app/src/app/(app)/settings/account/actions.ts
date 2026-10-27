"use server";

import { redirect } from "next/navigation";
import { requireUser, endSession } from "@/lib/auth";
import { withParam } from "@/lib/action";
import { AccountDeleteError, deleteAccount } from "@/lib/account-delete";

export async function deleteAccountAction(fd: FormData) {
  const { userId } = await requireUser();
  try {
    await deleteAccount(userId, typeof fd.get("password") === "string" ? (fd.get("password") as string) : "");
  } catch (e) {
    if (e instanceof AccountDeleteError) redirect(withParam("/settings/account", "error", e.message));
    throw e;
  }
  await endSession();
  redirect(withParam("/login", "ok", "Ditt konto är borttaget."));
}
