import crypto from 'node:crypto';
import { prisma } from '../db/prisma';
import { encryptSecret, decryptSecret } from '../utils/crypto';
import { generateSecret, verifyTotp, otpauthUri } from '../utils/totp';
import { config } from '../config/env';
import type { TokenPayload } from '../utils/jwt';
import { logger } from '../utils/logger';

/**
 * Two-factor authentication — requirements §13.
 *
 * Enrollment is two steps on purpose. `beginEnrollment` stores a secret but
 * leaves it disabled; only `completeEnrollment`, which requires a working code,
 * turns it on. A single-step design locks out any user whose authenticator
 * failed to scan the QR properly, and they cannot then log in to fix it.
 */

const RECOVERY_CODE_COUNT = 10;

/** Shape of app_2fa_lookup. */
interface TwoFactorRow {
  secret: string | null;
  last_step: bigint | null;
  enabled: boolean;
  school_id: string | null;
  role: TokenPayload['role'];
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  token_version: number;
  full_name: string;
}

const hashCode = (code: string) =>
  crypto.createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');

/** Users retype these off paper, so accept any spacing and either case. */
export const normaliseRecoveryCode = (code: string) =>
  code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * 10 characters of Crockford-ish base32, ~50 bits. Displayed in two groups so
 * they can be read aloud and typed without losing one's place.
 */
const makeRecoveryCode = (): string => {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789'; // no I, L, O, U — misread on paper
  const bytes = crypto.randomBytes(10);
  const body = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `${body.slice(0, 5)}-${body.slice(5)}`;
};

const loadTwoFactor = async (userId: string): Promise<TwoFactorRow | null> => {
  const rows = await prisma.$queryRaw<TwoFactorRow[]>`SELECT * FROM app_2fa_lookup(${userId}::uuid)`;
  return rows[0] ?? null;
};

export interface EnrollmentStart {
  secret: string;
  otpauthUri: string;
}

/**
 * Generates a secret and stores it disabled. Called again before confirmation
 * simply replaces it, so a user who abandoned a half-finished setup can start
 * over without an admin unpicking anything.
 */
export const beginEnrollment = async (
  userId: string,
  accountLabel: string
): Promise<EnrollmentStart> => {
  const secret = generateSecret();

  await prisma.$executeRaw`
    SELECT app_2fa_set_secret(${userId}::uuid, ${encryptSecret(secret)}, false)`;

  return {
    secret,
    otpauthUri: otpauthUri({ secret, accountName: accountLabel, issuer: config.totpIssuer }),
  };
};

export type EnrollmentResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; reason: 'not_started' | 'invalid_code' };

/**
 * Confirms enrollment with a live code and issues recovery codes.
 *
 * The codes are returned here and nowhere else — only their digests are kept,
 * so a later "show me my codes again" is impossible by construction rather than
 * by policy.
 */
export const completeEnrollment = async (
  userId: string,
  submittedCode: string
): Promise<EnrollmentResult> => {
  const row = await loadTwoFactor(userId);
  if (!row?.secret) return { ok: false, reason: 'not_started' };

  const result = verifyTotp(decryptSecret(row.secret), submittedCode, {
    lastUsedStep: row.last_step === null ? null : Number(row.last_step),
  });
  if (!result.ok) return { ok: false, reason: 'invalid_code' };

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, makeRecoveryCode);

  await prisma.$transaction([
    prisma.$executeRaw`SELECT app_2fa_enable(${userId}::uuid, ${BigInt(result.step)}::bigint)`,
    // Replace rather than append: re-enrolling must not leave codes from a
    // previous device in circulation.
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.recoveryCode.createMany({
      data: codes.map((code) => ({ codeHash: hashCode(code), userId })),
    }),
  ]);

  logger.info(`Two-factor enabled for user ${userId}`);
  return { ok: true, recoveryCodes: codes };
};

export type VerifyResult =
  | { ok: true; usedRecoveryCode: boolean; remainingRecoveryCodes: number }
  | { ok: false; reason: 'not_enabled' | 'invalid' | 'replayed' };

/**
 * The login-time check. Accepts either a TOTP code or an unused recovery code —
 * the caller does not have to say which, since the two are unambiguous by
 * shape and asking would only be a hint to an attacker.
 */
export const verifySecondFactor = async (
  userId: string,
  submitted: string
): Promise<VerifyResult> => {
  const row = await loadTwoFactor(userId);
  if (!row?.enabled || !row.secret) return { ok: false, reason: 'not_enabled' };

  const digitsOnly = /^\s*\d{6}\s*$/.test(submitted);

  if (digitsOnly) {
    const result = verifyTotp(decryptSecret(row.secret), submitted, {
      lastUsedStep: row.last_step === null ? null : Number(row.last_step),
    });

    if (!result.ok) return { ok: false, reason: result.reason };

    // Persisting the step is what consumes the code. If another request won the
    // race, treat this one as a replay rather than letting both through.
    const claimed = await prisma.$queryRaw<{ app_2fa_record_step: boolean }[]>`
      SELECT app_2fa_record_step(${userId}::uuid, ${BigInt(result.step)}::bigint)`;

    if (!claimed[0]?.app_2fa_record_step) return { ok: false, reason: 'replayed' };

    return {
      ok: true,
      usedRecoveryCode: false,
      remainingRecoveryCodes: await countUnusedRecoveryCodes(userId),
    };
  }

  const consumed = await prisma.$queryRaw<{ app_2fa_consume_recovery: boolean }[]>`
    SELECT app_2fa_consume_recovery(${userId}::uuid, ${hashCode(submitted)})`;

  if (!consumed[0]?.app_2fa_consume_recovery) return { ok: false, reason: 'invalid' };

  const remaining = await countUnusedRecoveryCodes(userId);
  logger.warn(`Recovery code used for user ${userId}; ${remaining} remaining`);

  return { ok: true, usedRecoveryCode: true, remainingRecoveryCodes: remaining };
};

export const countUnusedRecoveryCodes = (userId: string) =>
  prisma.recoveryCode.count({ where: { userId, usedAt: null } });

/** Issues a fresh set, invalidating the old one. */
export const regenerateRecoveryCodes = async (userId: string): Promise<string[]> => {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, makeRecoveryCode);

  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.recoveryCode.createMany({
      data: codes.map((code) => ({ codeHash: hashCode(code), userId })),
    }),
  ]);

  return codes;
};

/** Turns 2FA off and discards the secret and every recovery code. */
export const disableTwoFactor = async (userId: string): Promise<void> => {
  await prisma.$transaction([
    prisma.$executeRaw`SELECT app_2fa_disable(${userId}::uuid)`,
    prisma.recoveryCode.deleteMany({ where: { userId } }),
  ]);
  logger.warn(`Two-factor disabled for user ${userId}`);
};

export const twoFactorStatus = async (userId: string) => {
  const row = await loadTwoFactor(userId);
  return {
    enabled: Boolean(row?.enabled),
    pendingSetup: Boolean(row?.secret && !row.enabled),
    remainingRecoveryCodes: row?.enabled ? await countUnusedRecoveryCodes(userId) : 0,
  };
};
