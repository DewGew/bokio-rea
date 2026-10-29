import assert from "node:assert/strict";
import { test } from "node:test";
import { base32Decode, base32Encode, decryptSecret, encryptSecret, generateRecoveryCode, hotp, normalizeRecoveryCode, otpauthUri, verifyTotp } from "../src/lib/totp";

// Testvektorer ur RFC 6238 (SHA-1, hemlighet "12345678901234567890"), sexsiffriga koder.
const SECRET = Buffer.from("12345678901234567890");
const B32 = base32Encode(SECRET);
const vectors: [number, string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
];

test("TOTP ger rätt koder enligt RFC 6238", () => {
  for (const [t, code] of vectors) assert.equal(hotp(SECRET, Math.floor(t / 30)), code, `tid ${t}`);
});

test("base32 går att avkoda igen", () => {
  assert.equal(B32, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual(base32Decode(B32), SECRET);
  assert.deepEqual(base32Decode(B32.toLowerCase().replace(/(.{4})/g, "$1 ")), SECRET);
});

test("verifyTotp accepterar ±1 period men inte mer, och avvisar fel format", () => {
  const now = 1111111109 * 1000;
  const step = Math.floor(1111111109 / 30);
  assert.equal(verifyTotp(B32, "081804", now), step);
  assert.equal(verifyTotp(B32, "081 804", now), step);
  assert.equal(verifyTotp(B32, "081804", now + 30_000), step); // koden från föregående period
  assert.equal(verifyTotp(B32, "081804", now + 90_000), null);
  assert.equal(verifyTotp(B32, "000000", now), null);
  assert.equal(verifyTotp(B32, "12345", now), null);
  assert.equal(verifyTotp(B32, "abcdef", now), null);
});

test("krypteringen går att vända och fångar manipulation", () => {
  const enc = encryptSecret(B32, "en-lång-hemlig-nyckel-minst-32-tecken-lång");
  assert.ok(!enc.includes(B32));
  assert.equal(decryptSecret(enc, "en-lång-hemlig-nyckel-minst-32-tecken-lång"), B32);
  assert.throws(() => decryptSecret(enc, "fel-nyckel-fel-nyckel-fel-nyckel-fel"));
  assert.throws(() => decryptSecret(enc.slice(0, -2) + "xx", "en-lång-hemlig-nyckel-minst-32-tecken-lång"));
});

test("återställningskoder och otpauth-länk", () => {
  const c = generateRecoveryCode();
  assert.match(c, /^[a-z2-9]{5}-[a-z2-9]{5}$/);
  assert.equal(normalizeRecoveryCode(` ${c.toUpperCase()} `), c.replace("-", ""));
  const uri = otpauthUri(B32, "a@b.se", "Kapima Bokför");
  assert.ok(uri.startsWith("otpauth://totp/Kapima%20Bokf%C3%B6r%3Aa%40b.se?secret=" + B32));
});
