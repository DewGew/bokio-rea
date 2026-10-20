import "server-only";
import type { Company } from "@prisma/client";
import type { Logo } from "./invoice-pdf";
import { readStored } from "./storage";

/** Läser företagets logotyp (PNG/JPEG) för PDF-fakturor. */
export async function loadLogo(company: Company): Promise<Logo> {
  if (!company.logoStoredName || !company.logoMime) return null;
  const bytes = await readStored({ storedName: company.logoStoredName, blobUrl: company.logoBlobUrl });
  return bytes ? { bytes, mime: company.logoMime } : null;
}
