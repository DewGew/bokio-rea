import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidOcr, luhnCheckDigit, ocrNumber } from "../src/lib/ocr";

test("Luhn-kontrollsiffra enligt känt exempel", () => {
  assert.equal(luhnCheckDigit("7992739871"), 3);
});

test("OCR-nummer är fakturanumret plus kontrollsiffra", () => {
  for (const n of [1, 10, 100, 1000, 1001, 98765]) {
    const ocr = ocrNumber(n);
    assert.ok(ocr.startsWith(String(n)));
    assert.equal(ocr.length, String(n).length + 1);
    assert.ok(isValidOcr(ocr), `${ocr} ska vara giltigt`);
  }
  assert.equal(ocrNumber(1), "18");
});

test("Ogiltiga OCR-nummer avvisas", () => {
  assert.ok(!isValidOcr("19"));
  assert.ok(!isValidOcr("1"));
  assert.ok(!isValidOcr("12a4"));
  assert.throws(() => ocrNumber(0));
});
