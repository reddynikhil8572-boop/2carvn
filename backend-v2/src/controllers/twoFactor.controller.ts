import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../db/prisma';
import { withTenant, asSuperAdmin, TenantClient } from '../db/tenantContext';
import { verifyChallengeToken } from '../utils/jwt';
import { issueCookies } from './auth.controller';
import { issueNewFamily, revokeAllForUser } from '../services/refreshToken.service';
import {
  beginEnrollment,
  completeEnrollment,
  verifySecondFactor,
  regenerateRecoveryCodes,
  disableTwoFactor,
  twoFactorStatus,
} from '../services/twoFactor.service';
import { encryptionAvailable } from '../utils/crypto';
import { successResponse, errorResponse } from '../utils/responseFormat';
import { logger } from '../utils/logger';
import type {
  TwoFactorVerifyInput,
  TwoFactorEnableInput,
  TwoFactorDisableInput,
} from '../validators/auth.validator';

/**
 * Two-factor endpoints — requirements §13.
 *
 * Split across two trust levels. `/2fa/verify` is unauthenticated and consumes
 * the challenge token minted by a correct password; everything else sits behind
 * requireAuth and manages an existing session's enrollment.
 */

/** Reads the caller's own row. Works for SUPER_ADMIN, who has no tenant. */
const loadSelf = (
  userId: string,
  schoolId: string | null,
  select: Parameters<TenantClient['user']['findUnique']>[0]['select']
) => {
  const read = (tx: TenantClient) => tx.user.findUnique({ where: { id: userId }, select });
  return schoolId ? withTenant(schoolId, read) : asSuperAdmin(read);
};

/**
 * POST /api/v1/auth/2fa/verify — the second step of login.
 *
 * Accepts a TOTP code or a recovery code. Deliberately not behind requireAuth:
 * there is no session yet, which is the entire point.
 */
export const verify = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { challengeToken, code } = req.body as TwoFactorVerifyInput;

    const challenge = verifyChallengeToken(challengeToken);
    if (!challenge) {
      res.status(401).json(errorResponse('This sign-in attempt has expired. Please start again.'));
      return;
    }

    const result = await verifySecondFactor(challenge.userId, code);

    if (!result.ok) {
      // One message for a wrong code and a replayed one alike: distinguishing
      // them would tell an attacker that the code they captured was genuine.
      logger.warn(`Two-factor rejected for user ${challenge.userId} (${result.reason})`);
      res.status(401).json(errorResponse('Invalid authentication code'));
      return;
    }

    const user = await prisma.$queryRaw<
      {
        school_id: string | null;
        role: 'SUPER_ADMIN' | 'SCHOOL_ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
        status: string;
        token_version: number;
        full_name: string;
      }[]
    >`SELECT school_id, role, status, token_version, full_name FROM app_2fa_lookup(${challenge.userId}::uuid)`;

    const row = user[0];

    // The account may have been suspended, or every session revoked, in the
    // five minutes the challenge was valid for.
    if (!row || row.status !== 'ACTIVE' || row.token_version !== challenge.tokenVersion) {
      res.status(401).json(errorResponse('This sign-in attempt is no longer valid.'));
      return;
    }

    const payload = {
      userId: challenge.userId,
      schoolId: row.school_id,
      role: row.role,
      tokenVersion: row.token_version,
    };

    const { jti } = await issueNewFamily(challenge.userId);
    issueCookies(res, payload, jti);
    logger.info(
      `Login (2FA): ${challenge.userId} (${row.role})${result.usedRecoveryCode ? ' via recovery code' : ''}`
    );

    res.status(200).json(
      successResponse(
        {
          user: {
            id: challenge.userId,
            name: row.full_name,
            role: row.role,
            schoolId: row.school_id,
          },
          usedRecoveryCode: result.usedRecoveryCode,
          remainingRecoveryCodes: result.remainingRecoveryCodes,
        },
        'Login successful'
      )
    );
  } catch (error) {
    next(error);
  }
};

/** GET /api/v1/auth/2fa — whether the caller has it on, and codes remaining. */
export const status = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.status(200).json(successResponse(await twoFactorStatus(req.user!.userId), 'Fetched'));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/auth/2fa/setup — mints a secret and returns the otpauth URI.
 *
 * The URI is returned rather than a rendered QR image: the client already has
 * to display something, and generating the bitmap server-side would add a
 * dependency to ship a picture the browser can draw itself.
 */
export const setup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!encryptionAvailable()) {
      // Fail loudly rather than store the seed in plaintext.
      res
        .status(503)
        .json(errorResponse('Two-factor authentication is not configured on this server.'));
      return;
    }

    const auth = req.user!;
    const self = (await loadSelf(auth.userId, auth.schoolId, { email: true })) as {
      email: string;
    } | null;

    if (!self) {
      res.status(404).json(errorResponse('User not found'));
      return;
    }

    const enrollment = await beginEnrollment(auth.userId, self.email);

    res.status(200).json(
      successResponse(
        {
          secret: enrollment.secret, // for manual entry when a camera is unavailable
          otpauthUri: enrollment.otpauthUri,
        },
        'Scan this in your authenticator app, then confirm with a code'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/auth/2fa/enable — confirms setup with a live code.
 *
 * Returns the recovery codes once. They are stored only as digests, so this
 * response is the only opportunity the user will ever have to record them.
 */
export const enable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { code } = req.body as TwoFactorEnableInput;
    const result = await completeEnrollment(req.user!.userId, code);

    if (!result.ok) {
      const message =
        result.reason === 'not_started'
          ? 'Start setup before enabling two-factor authentication.'
          : 'That code did not match. Check your device clock and try again.';
      res.status(400).json(errorResponse(message));
      return;
    }

    res.status(200).json(
      successResponse(
        { recoveryCodes: result.recoveryCodes },
        'Two-factor authentication enabled. Save these recovery codes — they are shown only once.'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/auth/2fa/disable — requires the password again.
 *
 * Re-authenticating matters here: without it, a borrowed unlocked laptop is
 * enough to strip the second factor off an account.
 */
export const disable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { password } = req.body as TwoFactorDisableInput;
    const auth = req.user!;

    const self = (await loadSelf(auth.userId, auth.schoolId, { passwordHash: true })) as {
      passwordHash: string;
    } | null;

    if (!self || !(await bcrypt.compare(password, self.passwordHash))) {
      res.status(401).json(errorResponse('Incorrect password'));
      return;
    }

    await disableTwoFactor(auth.userId);

    // The security posture of every live session just dropped, and if the
    // request came from an attacker the legitimate user's sessions should die
    // with it. Cheap, and it surfaces the change immediately.
    await revokeAllForUser(auth.userId);

    res
      .status(200)
      .json(successResponse(null, 'Two-factor authentication disabled. Please sign in again.'));
  } catch (error) {
    next(error);
  }
};

/** POST /api/v1/auth/2fa/recovery-codes — replaces the set, password required. */
export const regenerate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { password } = req.body as TwoFactorDisableInput;
    const auth = req.user!;

    const self = (await loadSelf(auth.userId, auth.schoolId, { passwordHash: true })) as {
      passwordHash: string;
    } | null;

    if (!self || !(await bcrypt.compare(password, self.passwordHash))) {
      res.status(401).json(errorResponse('Incorrect password'));
      return;
    }

    const { enabled } = await twoFactorStatus(auth.userId);
    if (!enabled) {
      res.status(400).json(errorResponse('Two-factor authentication is not enabled.'));
      return;
    }

    res.status(200).json(
      successResponse(
        { recoveryCodes: await regenerateRecoveryCodes(auth.userId) },
        'New recovery codes issued. The previous set no longer works.'
      )
    );
  } catch (error) {
    next(error);
  }
};
