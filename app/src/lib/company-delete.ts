import "server-only";
import { db } from "./db";
import { deleteStored } from "./storage";

export class CompanyDeleteError extends Error {}

/**
 * Bokföringen i ett företag och vilka räkenskapsår som saknar en aktuell SIE-export.
 * Ett år räknas som exporterat om en export gjordes efter det senaste verifikatet i året.
 */
export async function companyBookkeeping(companyId: number) {
  const [perYear, exports] = await Promise.all([
    db.verification.groupBy({ by: ["fiscalYearId"], where: { companyId }, _count: { _all: true }, _max: { createdAt: true } }),
    db.sieExport.findMany({ where: { companyId } }),
  ]);
  const exportedAt = new Map(exports.map((e) => [e.fiscalYearId, e.exportedAt]));
  const missingIds = perYear
    .filter((y) => {
      const at = exportedAt.get(y.fiscalYearId);
      return !at || (y._max.createdAt !== null && at < y._max.createdAt);
    })
    .map((y) => y.fiscalYearId);
  const missingYears = missingIds.length
    ? await db.fiscalYear.findMany({ where: { id: { in: missingIds } }, orderBy: { start: "asc" } })
    : [];
  return {
    hasBookkeeping: perYear.length > 0,
    verifications: perYear.reduce((n, y) => n + y._count._all, 0),
    missingYears,
    blocked: missingYears.length > 0,
  };
}

/**
 * Databasoperationerna som tar bort ett företag. Verifikat och fakturor tas bort först: länkarna till
 * räkenskapsår och kunder är RESTRICT och kan annars stoppa företagets kaskadradering beroende på ordningen.
 */
export function companyPurgeOps(companyId: number) {
  return [
    db.invoice.deleteMany({ where: { companyId } }),
    db.verification.deleteMany({ where: { companyId } }),
    db.company.delete({ where: { id: companyId } }),
  ];
}

type CompanyFiles = { logoStoredName: string | null; logoBlobUrl: string | null; uploads: { storedName: string; blobUrl: string | null }[] };

/** Filerna som hör till ett företag, att städa ur lagringen efter att företaget raderats. */
export async function companyFiles(companyId: number): Promise<CompanyFiles | null> {
  return db.company.findUnique({
    where: { id: companyId },
    select: { logoStoredName: true, logoBlobUrl: true, uploads: { select: { storedName: true, blobUrl: true } } },
  });
}

/** Städar lagringen efteråt. Misslyckas det är företaget ändå borta. */
export async function deleteCompanyFiles(company: CompanyFiles) {
  const files = company.uploads.map((u) => ({ storedName: u.storedName, blobUrl: u.blobUrl }));
  if (company.logoStoredName) files.push({ storedName: company.logoStoredName, blobUrl: company.logoBlobUrl });
  await Promise.allSettled(files.map((f) => deleteStored(f)));
}

export const BOOKKEEPING_BLOCK_MESSAGE =
  "Företaget har bokföring som inte är exporterad. Exportera en SIE-fil för varje räkenskapsår under Inställningar → Import och export " +
  "och spara filerna på ett säkert ställe. Därefter kan företaget tas bort.";

/**
 * Tar bort ett företag med allt som hör till det. Bara ägaren, bara om användaren har fler företag,
 * och bara om all bokföring har exporterats som SIE-fil. Returnerar företaget som användaren ska byta till.
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

  await db.$transaction(companyPurgeOps(companyId));
  await deleteCompanyFiles(company);

  return other.companyId;
}
