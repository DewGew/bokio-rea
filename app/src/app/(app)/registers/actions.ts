"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWriter } from "@/lib/auth";
import { validOrgNumber } from "@/lib/company-setup";
import { str, withParam } from "@/lib/action";
import { parseKr } from "@/lib/money";

function done(path: string, msg: string): never {
  revalidatePath("/", "layout");
  redirect(withParam(path, "ok", msg));
}

export async function saveCustomer(fd: FormData) {
  const { companyId } = await requireWriter();
  const id = Number(str(fd, "id"));
  const name = str(fd, "name");
  if (!name) redirect(withParam("/customers", "error", "Kunden måste ha ett namn."));
  const data = {
    name,
    orgNumber: str(fd, "orgNumber"),
    email: str(fd, "email"),
    address: str(fd, "address"),
    postalCode: str(fd, "postalCode"),
    city: str(fd, "city"),
    reference: str(fd, "reference"),
  };
  if (id) await db.customer.updateMany({ where: { id, companyId }, data });
  else await db.customer.create({ data: { ...data, companyId } });
  done("/customers", id ? "Kunden är uppdaterad." : `${name} är tillagd.`);
}

export async function deleteCustomer(fd: FormData) {
  const { companyId } = await requireWriter();
  const id = Number(str(fd, "id"));
  const used = await db.invoice.count({ where: { customerId: id, companyId } });
  if (used) redirect(withParam("/customers", "error", "Kunden har fakturor och kan inte tas bort."));
  await db.customer.deleteMany({ where: { id, companyId } });
  done("/customers", "Kunden är borttagen.");
}

export async function saveArticle(fd: FormData) {
  const { companyId } = await requireWriter();
  const id = Number(str(fd, "id"));
  const name = str(fd, "name");
  const price = parseKr(str(fd, "price"));
  if (!name || price == null) redirect(withParam("/articles", "error", "Ange namn och pris."));
  const data = { name, price, unit: str(fd, "unit") || "st", vatRate: Number(str(fd, "vatRate")) || 0, type: str(fd, "type") || "service" };
  if (id) await db.article.updateMany({ where: { id, companyId }, data });
  else await db.article.create({ data: { ...data, companyId } });
  done("/articles", id ? "Artikeln är uppdaterad." : `${name} är tillagd.`);
}

export async function deleteArticle(fd: FormData) {
  const { companyId } = await requireWriter();
  await db.article.deleteMany({ where: { id: Number(str(fd, "id")), companyId } });
  done("/articles", "Artikeln är borttagen.");
}

export async function saveCompany(fd: FormData) {
  const { companyId } = await requireWriter();
  const name = str(fd, "name");
  const orgNumber = str(fd, "orgNumber");
  if (!name || !validOrgNumber(orgNumber)) redirect(withParam("/settings", "error", "Ange företagsnamn och ett giltigt organisationsnummer."));
  await db.company.update({
    where: { id: companyId },
    data: {
      name,
      orgNumber,
      vatNumber: str(fd, "vatNumber"),
      address: str(fd, "address"),
      postalCode: str(fd, "postalCode"),
      city: str(fd, "city"),
      email: str(fd, "email"),
      bankgiro: str(fd, "bankgiro"),
      invoiceDays: Math.min(365, Math.max(0, Number(str(fd, "invoiceDays")) || 30)),
    },
  });
  done("/settings", "Företagsuppgifterna är sparade.");
}

export async function saveAccount(fd: FormData) {
  const { companyId } = await requireWriter();
  const number = Number(str(fd, "number"));
  const name = str(fd, "name");
  if (!(number >= 1000 && number <= 8999) || !name) redirect(withParam("/settings/accounts", "error", "Ange ett kontonummer 1000–8999 och ett namn."));
  await db.account.upsert({
    where: { companyId_number: { companyId, number } },
    create: { companyId, number, name, vatCode: str(fd, "vatCode") },
    update: { name, vatCode: str(fd, "vatCode") },
  });
  done("/settings/accounts", `Konto ${number} är sparat.`);
}

export async function toggleAccount(fd: FormData) {
  const { companyId } = await requireWriter();
  const number = Number(str(fd, "number"));
  const where = { companyId_number: { companyId, number } };
  const a = await db.account.findUnique({ where });
  if (a) await db.account.update({ where, data: { active: !a.active } });
  done("/settings/accounts", `Konto ${number} är ${a?.active ? "inaktiverat" : "aktiverat"}.`);
}

export async function saveTemplate(fd: FormData) {
  const { companyId } = await requireWriter();
  const name = str(fd, "name");
  const costAccount = Number(str(fd, "costAccount"));
  if (!name || !costAccount) redirect(withParam("/settings/templates", "error", "Ange namn och konto."));
  const exists = await db.account.findUnique({ where: { companyId_number: { companyId, number: costAccount } } });
  if (!exists) redirect(withParam("/settings/templates", "error", `Kontot ${costAccount} finns inte.`));
  const direction = ["purchase", "sale", "reverse"].includes(str(fd, "direction")) ? str(fd, "direction") : "purchase";
  await db.template.create({
    data: {
      companyId,
      name,
      category: str(fd, "category") || "Övrigt",
      costAccount,
      vatRate: Number(str(fd, "vatRate")) || 0,
      direction,
      keywords: str(fd, "keywords"),
    },
  });
  done("/settings/templates", `Mallen ${name} är skapad.`);
}

export async function deleteTemplate(fd: FormData) {
  const { companyId } = await requireWriter();
  await db.template.deleteMany({ where: { id: Number(str(fd, "id")), companyId } });
  done("/settings/templates", "Mallen är borttagen.");
}
