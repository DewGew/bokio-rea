import "server-only";
import { db } from "./db";
import { deleteStored } from "./storage";

export class CompanyDeleteError extends Error {}

/** Bokföring som finns kvar i företaget. Företag med bokföring kan inte tas bort. */
export async function companyBookkeeping(companyId: number) {
  const [verifications, issuedInvoices] = await Promise.all([
    db.verification.count({ where: { companyId } }),
    db.invoice.count({ where: { companyId, status: { not: "draft" } } }),
  ]);
  return { verifications, issuedInvoices, blocked: verifications > 0 || issuedInvoices > 0 };
}

export const BOOKKEEPING_BLOCK_MESSAGE =
  "Företaget har bokföring och kan därför inte tas bort. Bokföringen ska bevaras i sju år (bokföringslagen). " +
  "Exportera en SIE-fil under Inställningar → Import och export först och spara den på ett säkert ställe.";

/**
 * Tar bort ett företag med allt som hör till det. Bara ägaren, bara om användaren har fler företag,
 * och aldrig om det finns bokföring. Returnerar företaget som användaren ska byta till.
 */
export async function deleteCompany(opts: { companyId: number; userId: number; role: string; confirmName: string }) {
  const { companyId, userId, role, confirmName } = opts;
  if (role !== "owner") throw new CompanyDeleteError("Bara företagets ägare kan ta bort företaget.");

  const memberships = await db.membership.findMany({ where: { userId }, orderBy: { companyId: "asc" } });
  const other = memberships.find((m) => m.companyId !== companyId);
  if (!other) throw new CompanyDeleteError("Du kan inte ta bort ditt enda företag. Skapa eller bli inbjuden till ett annat företag först.");

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { name: true, logoStoredName: true, logoBlobUrl: true, uploads: { select: { storedName: true, blobUrl: true } } },
  });
  if (!company) throw new CompanyDeleteError("Företaget finns inte.");
  if (confirmName.trim().toLowerCase() !== company.name.trim().toLowerCase()) {
    throw new CompanyDeleteError("Företagsnamnet du skrev stämmer inte. Inget har tagits bort.");
  }
  if ((await companyBookkeeping(companyId)).blocked) throw new CompanyDeleteError(BOOKKEEPING_BLOCK_MESSAGE);

  await db.company.delete({ where: { id: companyId } });

  // Filer i lagringen städas efteråt. Misslyckas det här är företaget ändå borta.
  const files = company.uploads.map((u) => ({ storedName: u.storedName, blobUrl: u.blobUrl }));
  if (company.logoStoredName) files.push({ storedName: company.logoStoredName, blobUrl: company.logoBlobUrl });
  await Promise.allSettled(files.map((f) => deleteStored(f)));

  return other.companyId;
}
