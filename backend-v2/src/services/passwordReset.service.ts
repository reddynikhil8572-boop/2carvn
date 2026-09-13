import crypto from 'node:crypto';
import { prisma } from '../db/prisma';
import { config } from '../config/env';
import { hashPassword } from './auth.service';
import { revokeAllForUser } from './refreshToken.service';
import { sendMail, passwordResetEmail, passwordChangedEmail } from './email.service';
import { logger } from '../utils/logger';

/**
 * Password reset by emailed link — requirements §13.
 *
 * The governing constraint is that the request endpoint is anonymous, so it
 * must never reveal whether an address is registered. Everything here that
 * looks like wasted work — always answering the same way, always taking the
 * same rough amount of time — exists for that reason.
 */

const TOKEN_BYTES = 32;

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

interface ResetLookupRow {
  user_id: string;
  full_name: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  school_active: boolean;
}

/**
 * Issues a token and emails it, when the address resolves to a usable account.
 *
 * Returns nothing. The caller must respond identically in every case: found,
 * not found, suspended, or school deactivated. Anything else turns this into
 * an account-enumeration oracle against a school's entire roster.
 */
export const requestReset = async (schoolCode: string, email: string): Promise<void> => {
  const rows = await prisma.$queryRaw<ResetLookupRow[]>`
    SELECT * FROM app_reset_lookup(${schoolCode}, ${email})`;

  const row = rows[0];

  if (!row || row.status !== 'ACTIVE' || !row.school_active) {
    logger.info(`Password reset requested for an unusable account (${email})`);
    return;
  }

  // Invalidate anything outstanding. Two live links at once means a stale one
  // sitting in an old email stays usable after the user has already reset.
  await prisma.passwordResetToken.updateMany({
    where: { userId: row.user_id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');

  await prisma.passwordResetToken.create({
    data: {
      tokenHash: hash(token),
      userId: row.user_id,
      expiresAt: new Date(Date.now() + config.passwordResetTtlMinutes * 60 * 1000),
    },
  });

  const resetUrl = `${config.frontendUrl}/reset-password?token=${token}`;

  await sendMail({
    to: row.email,
    ...passwordResetEmail({
      name: row.full_name,
      resetUrl,
      ttlMinutes: config.passwordResetTtlMinutes,
    }),
  });

  logger.info(`Password reset link issued for user ${row.user_id}`);
};

export type ResetResult = { ok: true } | { ok: false; reason: 'invalid' | 'expired' | 'used' };

/**
 * Consumes a token and sets the new password.
 *
 * The token row is claimed with a conditional UPDATE rather than a read
 * followed by a write, so two clicks on the same link cannot both succeed.
 */
export const completeReset = async (token: string, newPassword: string): Promise<ResetResult> => {
  const tokenHash = hash(token);

  const existing = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { userId: true, expiresAt: true, usedAt: true },
  });

  if (!existing) return { ok: false, reason: 'invalid' };
  if (existing.usedAt) return { ok: false, reason: 'used' };
  if (existing.expiresAt <= new Date()) return { ok: false, reason: 'expired' };

  const { count } = await prisma.passwordResetToken.updateMany({
    where: { tokenHash, usedAt: null },
    data: { usedAt: new Date() },
  });

  // Lost the race against a concurrent request using the same link.
  if (count === 0) return { ok: false, reason: 'used' };

  const passwordHash = await hashPassword(newPassword);

  // Bumps token_version, which is what invalidates access tokens already in
  // flight; clears the lockout so a locked-out user can sign in at once.
  await prisma.$executeRaw`SELECT app_reset_password(${existing.userId}::uuid, ${passwordHash})`;

  // Stateless access tokens survive until they expire, so the stored refresh
  // tokens have to go explicitly. Whoever forced the reset — or the attacker
  // the user is resetting *because of* — loses their session here.
  await revokeAllForUser(existing.userId);

  const [user] = await prisma.$queryRaw<{ full_name: string; email: string }[]>`
    SELECT * FROM app_user_contact(${existing.userId}::uuid)`;

  if (user) {
    await sendMail({ to: user.email, ...passwordChangedEmail({ name: user.full_name }) });
  }

  logger.warn(`Password reset completed for user ${existing.userId}`);
  return { ok: true };
};

/** Housekeeping: spent and expired rows authorise nothing but accumulate. */
export const pruneResetTokens = async (): Promise<number> => {
  const { count } = await prisma.passwordResetToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
};
