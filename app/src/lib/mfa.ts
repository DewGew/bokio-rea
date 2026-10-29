import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { hashToken } from "./token";
import { decryptSecret, encryptSecret, generateRecoveryCode, generateSecret, normalizeRecoveryCode, verifyTotp } from "./totp";

const KEY = () => process.env.MFA_ENCRYPTION_KEY ?? "";
export const MFA_ISSUER = "Kapima Bokför";
export const RECOVERY_CODE_COUNT = 8;

/** Tvåfaktor kräver en krypteringsnyckel (minst 32 tecken) i MFA_ENCRYPTION_KEY. */
export const mfaAvailable = () => KEY().length >= 32;

const FAIL_WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 10;

/** För många felaktiga koder för ett konto de senaste 15 minuterna. */
export async function tooManyMfaFailures(userId: number) {
  const n = await db.systemEvent.count({ where: { kind: "mfa_failed", detail: `user:${userId}`, createdAt: { gt: new Date(Date.now() - FAIL_WINDOW_MS) } } });
  return n >= MAX_FAILS;
}

export const logMfaFailure = (userId: number) => db.systemEvent.create({ data: { kind: "mfa_failed", detail: `user:${userId}` } }).catch(() => {});

const hashCode = (code: string) => hashToken(normalizeRecoveryCode(code));

// ---------------------------------------------------------------- Aktivering

/** Skapar en ny, ännu obekräftad nyckel. Ersätter en tidigare obekräftad. */
export async function startSetup(userId: number): Promise<void> {
  if (!mfaAvailable()) throw new Error("Tvåfaktor är inte konfigurerat på servern.");
  await db.user.updateMany({ where: { id: userId, mfaEnabledAt: null }, data: { mfaSecret: encryptSecret(generateSecret(), KEY()), mfaLastStep: null } });
}

export async function pendingSecret(userId: number): Promise<string | null> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { mfaSecret: true, mfaEnabledAt: true } });
  if (!u?.mfaSecret || u.mfaEnabledAt) return null;
  return decryptSecret(u.mfaSecret, KEY());
}

function newRecoveryCodes() {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  return { codes, rows: codes.map((c) => ({ codeHash: hashCode(c) })) };
}

/** Bekräftar aktiveringen med en kod från appen. Returnerar återställningskoderna (visas bara en gång), eller null om koden är fel. */
export async function confirmSetup(userId: number, code: string): Promise<string[] | null> {
  const secret = await pendingSecret(userId);
  if (!secret) return null;
  const step = verifyTotp(secret, code);
  if (step === null) return null;
  const { codes, rows } = newRecoveryCodes();
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { mfaEnabledAt: new Date(), mfaLastStep: step } }),
    db.mfaRecoveryCode.deleteMany({ where: { userId } }),
    db.mfaRecoveryCode.createMany({ data: rows.map((r) => ({ ...r, userId })) }),
  ]);
  return codes;
}

export async function regenerateRecoveryCodes(userId: number): Promise<string[]> {
  const { codes, rows } = newRecoveryCodes();
  await db.$transaction([db.mfaRecoveryCode.deleteMany({ where: { userId } }), db.mfaRecoveryCode.createMany({ data: rows.map((r) => ({ ...r, userId })) })]);
  return codes;
}

export async function recoveryCodesLeft(userId: number) {
  return db.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
}

/** Stänger av tvåfaktor och rensar nyckel, återställningskoder och pågående inloggningar. */
export async function disableMfa(userId: number) {
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null } }),
    db.mfaRecoveryCode.deleteMany({ where: { userId } }),
    db.mfaChallenge.deleteMany({ where: { userId } }),
  ]);
}

// ---------------------------------------------------------------- Kontroll av koder

/**
 * Kontrollerar en kod från autentiseringsappen eller en återställningskod. Varje kod fungerar bara en gång.
 * Returnerar true om koden var giltig (och är förbrukad).
 */
export async function verifyUserCode(userId: number, input: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { mfaSecret: true, mfaEnabledAt: true, mfaLastStep: true } });
  if (!u?.mfaSecret || !u.mfaEnabledAt || !mfaAvailable()) return false;
  const clean = input.trim();

  if (/^[\d\s]{6,7}$/.test(clean)) {
    let secret: string;
    try {
      secret = decryptSecret(u.mfaSecret, KEY());
    } catch {
      return false;
    }
    const step = verifyTotp(secret, clean);
    if (step === null) return false;
    // Atomiskt: samma period (eller en tidigare) kan inte användas igen.
    const { count } = await db.user.updateMany({ where: { id: userId, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] }, data: { mfaLastStep: step } });
    return count === 1;
  }

  const norm = normalizeRecoveryCode(clean);
  if (norm.length !== 10) return false;
  const row = await db.mfaRecoveryCode.findFirst({ where: { userId, usedAt: null, codeHash: hashToken(norm) } });
  if (!row) return false;
  const { count } = await db.mfaRecoveryCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  return count === 1;
}

// ---------------------------------------------------------------- Mellansteg i inloggningen

export const MFA_COOKIE = "hb_mfa";
const CHALLENGE_MINUTES = 5;
export const MAX_ATTEMPTS = 5;

export async function createChallenge(userId: number, next: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CHALLENGE_MINUTES * 60_000);
  await db.mfaChallenge.deleteMany({ where: { OR: [{ userId }, { expiresAt: { lt: new Date() } }] } });
  await db.mfaChallenge.create({ data: { userId, tokenHash: hashToken(token), next, expiresAt } });
  (await cookies()).set(MFA_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
}

export async function readChallenge() {
  const token = (await cookies()).get(MFA_COOKIE)?.value;
  if (!token) return null;
  const ch = await db.mfaChallenge.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!ch || ch.expiresAt < new Date()) return null;
  return ch;
}

export async function clearChallenge(id?: number) {
  if (id) await db.mfaChallenge.deleteMany({ where: { id } });
  (await cookies()).delete(MFA_COOKIE);
}

/** Räknar upp misslyckade försök. Efter MAX_ATTEMPTS förstörs mellansteget och användaren får logga in på nytt. Returnerar true om det fortfarande går att försöka. */
export async function failChallenge(id: number): Promise<boolean> {
  const ch = await db.mfaChallenge.update({ where: { id }, data: { attempts: { increment: 1 } } }).catch(() => null);
  if (!ch || ch.attempts >= MAX_ATTEMPTS) {
    await clearChallenge(id);
    return false;
  }
  return true;
}
