"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireCompany } from "@/lib/auth";
import { revokeGrant } from "@/lib/oauth";

/** Kopplar från: ägaren kan koppla från alla kopplingar i företaget, övriga bara sina egna. */
export async function revokeConnectionAction(fd: FormData) {
  const { companyId, role, user } = await requireCompany();
  const grant = await db.oAuthGrant.findFirst({ where: { id: Number(fd.get("id")) || -1, companyId } });
  if (!grant || (role !== "owner" && grant.userId !== user.id)) redirect("/settings/connections?error=" + encodeURIComponent("Du kan bara koppla från dina egna kopplingar."));
  await revokeGrant(grant.id);
  redirect("/settings/connections?ok=" + encodeURIComponent("Kopplingen är bortkopplad och kan inte längre läsa något."));
}
