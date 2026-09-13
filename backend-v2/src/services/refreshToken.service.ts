import crypto from 'node:crypto';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';

/**
 * Refresh-token rotation with reuse detection.
 *
 * Each refresh mints a new token and marks the old one rotated. Presenting an
 * already-rotated token means two parties hold it — the legitimate client and
 * whoever copied it — and there is no way to tell which one is calling. The
 * safe response is to burn the entire family, forcing a fresh login.
 *
 * Only a SHA-256 of the jti is stored, so a database leak does not hand out
 * usable sessions.
 */

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hash = (jti: string) => crypto.createHash('sha256').update(jti).digest('hex');

export interface IssuedToken {
  jti: string;
  familyId: string;
}

/** Starts a new family. Called on login, never on refresh. */
export const issueNewFamily = async (userId: string): Promise<IssuedToken> => {
  const jti = crypto.randomUUID();
  const familyId = crypto.randomUUID();

  await prisma.refreshToken.create({
    data: {
      tokenHash: hash(jti),
      userId,
      familyId,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });

  return { jti, familyId };
};

export type RotationResult =
  | { ok: true; token: IssuedToken }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'reused' };

/**
 * Consumes `jti` and issues its successor.
 *
 * The read and both writes happen in one transaction so two concurrent
 * refreshes cannot both succeed — the second sees the row already rotated and
 * is treated as a replay.
 */
export const rotate = async (jti: string, userId: string): Promise<RotationResult> => {
  const tokenHash = hash(jti);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing || existing.userId !== userId) {
      return { ok: false, reason: 'unknown' as const };
    }

    if (existing.rotatedAt) {
      // Replay. Burn the family: the holder of the newer token is just as
      // likely to be the attacker as the victim.
      const { count } = await tx.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      logger.warn(
        `Refresh token reuse detected for user ${userId}; revoked ${count} token(s) in family ${existing.familyId}`
      );
      return { ok: false, reason: 'reused' as const };
    }

    if (existing.revokedAt) {
      return { ok: false, reason: 'revoked' as const };
    }

    if (existing.expiresAt <= new Date()) {
      return { ok: false, reason: 'expired' as const };
    }

    const nextJti = crypto.randomUUID();

    await tx.refreshToken.update({
      where: { tokenHash },
      data: { rotatedAt: new Date() },
    });

    await tx.refreshToken.create({
      data: {
        tokenHash: hash(nextJti),
        userId,
        familyId: existing.familyId, // stays in the same family
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });

    return { ok: true, token: { jti: nextJti, familyId: existing.familyId } };
  });
};

/** Ends one session. Used by logout. */
export const revokeToken = async (jti: string): Promise<void> => {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hash(jti), revokedAt: null },
    data: { revokedAt: new Date() },
  });
};

/** Ends every session for a user — password change, admin action, 2FA reset. */
export const revokeAllForUser = async (userId: string): Promise<number> => {
  const { count } = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
};

/**
 * Deletes rows that can no longer authorise anything. Expired-but-present rows
 * are harmless, but the table would otherwise grow without bound.
 */
export const pruneExpired = async (): Promise<number> => {
  const { count } = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
};
