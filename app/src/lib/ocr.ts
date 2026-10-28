/**
 * OCR-nummer (betalningsreferens) för bankgiro och plusgiro: fakturanumret följt av en kontrollsiffra (Luhn, mod 10).
 * Hela numret ska vara 2–25 siffror. Det har ingen längdsiffra.
 */

/** Luhn-kontrollsiffran för en sifferrad (siffran längst till höger i raden dubbleras först). */
export function luhnCheckDigit(digits: string): number {
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

/** OCR-numret för ett fakturanummer: numret plus kontrollsiffra. */
export function ocrNumber(invoiceNumber: number): string {
  if (!Number.isInteger(invoiceNumber) || invoiceNumber < 1) throw new RangeError("Fakturanumret måste vara ett positivt heltal.");
  const base = String(invoiceNumber);
  return base + luhnCheckDigit(base);
}

export function isValidOcr(ocr: string): boolean {
  return /^\d{2,25}$/.test(ocr) && luhnCheckDigit(ocr.slice(0, -1)) === Number(ocr.slice(-1));
}
