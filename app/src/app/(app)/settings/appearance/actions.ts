"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export async function setTheme(theme: string) {
  const s = await requireUser();
  if (!["system", "light", "dark"].includes(theme)) return;
  await db.user.update({ where: { id: s.userId }, data: { theme } });
  revalidatePath("/", "layout");
}
