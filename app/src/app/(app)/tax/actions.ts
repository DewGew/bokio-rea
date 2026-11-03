"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWriter } from "@/lib/auth";

const field = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const refresh = () => revalidatePath("/tax");

export async function addTaxPartnerAction(fd: FormData) {
  const { companyId, company } = await requireWriter();
  if (!["ef", "hb"].includes(company.companyType)) return;
  const name = field(fd, "name").slice(0, 100);
  if (!name) return;
  if (company.companyType === "ef" && await db.taxPartner.count({ where: { companyId } })) return;
  await db.taxPartner.create({ data: { companyId, name, sharePercent: company.companyType === "ef" ? 100 : 0 } });
  refresh();
}

export async function saveTaxPartnerAction(fd: FormData) {
  const { companyId, company } = await requireWriter();
  if (!["ef", "hb"].includes(company.companyType)) return;
  const id = Number(field(fd, "id"));
  const name = field(fd, "name").slice(0, 100);
  const sharePercent = company.companyType === "ef" ? 100 : Number(field(fd, "sharePercent"));
  const birthYear = Number(field(fd, "birthYear"));
  const municipalityTaxRate = Number(field(fd, "municipalityTaxRate"));
  const activityType = field(fd, "activityType");
  const year = new Date().getFullYear();
  if (!Number.isInteger(id) || !name || !Number.isFinite(sharePercent) || sharePercent < 0 || sharePercent > 100 ||
      !Number.isInteger(birthYear) || birthYear < 1900 || birthYear > year ||
      !Number.isFinite(municipalityTaxRate) || municipalityTaxRate < 0 || municipalityTaxRate > 60 ||
      !["active", "passive"].includes(activityType)) return;
  await db.taxPartner.updateMany({
    where: { id, companyId },
    data: { name, sharePercent, birthYear, municipalityTaxRate, activityType },
  });
  refresh();
}

export async function deleteTaxPartnerAction(fd: FormData) {
  const { companyId, company } = await requireWriter();
  if (!["ef", "hb"].includes(company.companyType)) return;
  await db.taxPartner.deleteMany({ where: { id: Number(field(fd, "id")) || -1, companyId } });
  refresh();
}
