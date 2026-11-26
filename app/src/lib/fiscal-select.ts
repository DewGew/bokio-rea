import "server-only";
import { cookies } from "next/headers";
import { currentFiscalYear, fiscalYears } from "./fiscal";

/** Cookie med det räkenskapsår användaren valt i sidopanelen (id), en per företag. */
export const fyCookieName = (companyId: number) => `hb_fy_${companyId}`;

/**
 * Räkenskapsåret som hela appen visar: det användaren valt i sidopanelen, annars det som pågår idag.
 * `current` är året som pågår idag, så att sidor kan se om ett annat år visas.
 */
export async function selectedFiscalYear(companyId: number) {
  const [all, current] = await Promise.all([fiscalYears(companyId), currentFiscalYear(companyId)]);
  const id = Number((await cookies()).get(fyCookieName(companyId))?.value);
  const fy = all.find((y) => y.id === id) ?? current;
  return { all: all.some((y) => y.id === current.id) ? all : [...all, current], fy, current };
}
