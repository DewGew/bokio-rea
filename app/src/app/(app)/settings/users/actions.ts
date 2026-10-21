"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { attempt, str } from "@/lib/action";
import { MemberError, createInvitation, removeMember, setMemberRole } from "@/lib/members";

export type InviteState = { link: string; email: string; role: string } | { error: string } | undefined;

async function origin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

export async function inviteAction(_: InviteState, fd: FormData): Promise<InviteState> {
  const { companyId, user } = await requireOwner();
  try {
    const token = await createInvitation(companyId, user.id, str(fd, "email"), str(fd, "role"));
    return { link: `${await origin()}/invite/${token}`, email: str(fd, "email").toLowerCase(), role: str(fd, "role") };
  } catch (e) {
    if (e instanceof MemberError) return { error: e.message };
    throw e;
  }
}

const done = (msg: string) => redirect("/settings/users?ok=" + encodeURIComponent(msg));

export async function revokeInvitationAction(fd: FormData) {
  const { companyId } = await requireOwner();
  await db.invitation.deleteMany({ where: { id: Number(fd.get("id")) || -1, companyId, acceptedAt: null } });
  done("Inbjudan är återkallad.");
}

export async function changeRoleAction(fd: FormData) {
  const { companyId } = await requireOwner();
  await attempt(() => setMemberRole(companyId, Number(fd.get("userId")), str(fd, "role")), "/settings/users");
  done("Behörigheten är ändrad.");
}

export async function removeMemberAction(fd: FormData) {
  const { companyId } = await requireOwner();
  await attempt(() => removeMember(companyId, Number(fd.get("userId"))), "/settings/users");
  done("Användaren har inte längre tillgång till företaget.");
}
