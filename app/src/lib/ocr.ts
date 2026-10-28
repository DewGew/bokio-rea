/**
 * OCR-nummer (betalningsreferens) för bankgiro och plusgiro enligt Bankgirots svenska OCR-standard med kontrollsiffra
 * enligt Modulus 10: fakturanumret följt av en kontrollsiffra. Hela numret är 2–25 siffror och har ingen längdsiffra.
 *
 * Modulus 10 (samma metod som i personnummer): siffrorna före kontrollsiffran viktas 2, 1, 2, 1 … räknat från höger, så att siffran
 * närmast kontrollsiffran får vikt 2. Produkter över 9 ersätts med sin siffersumma (14 → 1 + 4 = 5). Kontrollsiffran är det tal
 * som gör att den totala summan blir jämnt delbar med 10.
 */
/** Kontrollsiffra enligt Modulus 10 för en sifferrad (siffran längst till höger i raden får vikt 2). */
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
