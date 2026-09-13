import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { authenticate } from '../services/auth.service';
import { withTenant, asSuperAdmin, TenantClient } from '../db/tenantContext';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  generateChallengeToken,
  CHALLENGE_TTL_SECONDS,
  TokenPayload,
} from '../utils/jwt';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../middlewares/auth';
import {
  issueNewFamily,
  rotate,
  revokeToken,
} from '../services/refreshToken.service';
import { successResponse, errorResponse } from '../utils/responseFormat';
import { logger } from '../utils/logger';
import type { LoginInput } from '../validators/auth.validator';

const isProduction = config.nodeEnv === 'production';

const COOKIE_BASE = {
  httpOnly: true, // unreadable from JS, so XSS cannot exfiltrate the token
  secure: isProduction,
  sameSite: isProduction ? ('none' as const) : ('lax' as const),
  path: '/',
};

const ACCESS_COOKIE_OPTIONS = { ...COOKIE_BASE, maxAge: 15 * 60 * 1000 };
const REFRESH_COOKIE_OPTIONS = { ...COOKIE_BASE, maxAge: 7 * 24 * 60 * 60 * 1000 };

export const clearCookies = (res: Response) => {
  res.clearCookie(ACCESS_COOKIE, COOKIE_BASE);
  res.clearCookie(REFRESH_COOKIE, COOKIE_BASE);
};

/**
 * Issues both cookies. The refresh token carries a `jti` bound to a stored row
 * so it can be rotated and individually revoked; the access token stays
 * stateless so verifying it needs no database round trip.
 */
export const issueCookies = (res: Response, payload: TokenPayload, jti: string) => {
  res.cookie(ACCESS_COOKIE, generateAccessToken(payload), ACCESS_COOKIE_OPTIONS);
  res.cookie(REFRESH_COOKIE, generateRefreshToken({ ...payload, jti }), REFRESH_COOKIE_OPTIONS);
};

/**
 * POST /api/v1/auth/login
 * School-scoped: the same email may exist at several schools, so the school
 * code is part of the identity being authenticated.
 */
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { schoolCode, email, password } = req.body as LoginInput;
    const result = await authenticate(schoolCode, email, password);

    if (!result.ok) {
      switch (result.failure.kind) {
        case 'locked':
          res.status(423).json(
            errorResponse('Account locked due to too many failed attempts.', {
              code: 'ACCOUNT_LOCKED',
              retryAfter: result.failure.retryAfterSeconds,
            })
          );
          return;
        case 'suspended':
          res.status(403).json(errorResponse('This account is not active. Contact your school.'));
          return;
        case 'school_inactive':
          res.status(403).json(errorResponse('This school is not currently active.'));
          return;
        default:
          // One message for unknown email and wrong password alike — never
          // confirm whether an address is registered.
          res.status(401).json(
            errorResponse(
              'Invalid credentials',
              result.attemptsRemaining !== undefined
                ? { attemptsRemaining: result.attemptsRemaining }
                : null
            )
          );
          return;
      }
    }

    // With 2FA on, a correct password buys only a challenge — no cookies are
    // set, so a stolen password alone yields nothing that can call the API.
    if (result.twoFactorEnabled) {
      const challengeToken = generateChallengeToken({
        userId: result.payload.userId,
        tokenVersion: result.payload.tokenVersion,
      });

      res.status(200).json(
        successResponse(
          { twoFactorRequired: true, challengeToken, expiresIn: CHALLENGE_TTL_SECONDS },
          'Enter your authentication code'
        )
      );
      return;
    }

    // A login starts a new token family; refreshes stay within it.
    const { jti } = await issueNewFamily(result.payload.userId);
    issueCookies(res, result.payload, jti);
    logger.info(`Login: ${result.payload.userId} (${result.payload.role})`);

    res.status(200).json(
      successResponse(
        {
          twoFactorRequired: false,
          user: {
            id: result.payload.userId,
            name: result.name,
            email,
            role: result.payload.role,
            schoolId: result.payload.schoolId,
          },
        },
        'Login successful'
      )
    );
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/auth/refresh
 *
 * Rotates the refresh token — the presented one is consumed and a successor
 * issued. Presenting an already-rotated token is treated as theft and burns
 * the whole family; see services/refreshToken.service.ts.
 *
 * Also re-reads tokenVersion, so bumping it revokes sessions at the next
 * refresh rather than waiting for the access token to expire.
 */
export const refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) {
      res.status(401).json(errorResponse('Missing refresh token'));
      return;
    }

    const decoded = verifyRefreshToken(token);
    if (!decoded?.jti) {
      res.status(401).json(errorResponse('Invalid or expired refresh token'));
      return;
    }

    const load = (tx: TenantClient) =>
      tx.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, role: true, schoolId: true, status: true, tokenVersion: true },
      });

    const user = decoded.schoolId
      ? await withTenant(decoded.schoolId, load)
      : await asSuperAdmin(load);

    if (!user || user.status !== 'ACTIVE' || user.tokenVersion !== decoded.tokenVersion) {
      clearCookies(res);
      res.status(401).json(errorResponse('Session is no longer valid'));
      return;
    }

    const rotation = await rotate(decoded.jti, decoded.userId);

    if (!rotation.ok) {
      clearCookies(res);
      if (rotation.reason === 'reused') {
        // Every session in the family is now revoked; say so plainly so the
        // user understands why they are being asked to sign in again.
        res
          .status(401)
          .json(errorResponse('Session reuse detected. All sessions have been signed out.'));
        return;
      }
      res.status(401).json(errorResponse('Session is no longer valid'));
      return;
    }

    issueCookies(
      res,
      {
        userId: user.id,
        schoolId: user.schoolId,
        role: user.role,
        tokenVersion: user.tokenVersion,
      },
      rotation.token.jti
    );

    res.status(200).json(successResponse(null, 'Session refreshed'));
  } catch (error) {
    next(error);
  }
};

/** POST /api/v1/auth/logout — revokes this session's refresh token. */
export const logout = async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.[REFRESH_COOKIE];
  const decoded = token ? verifyRefreshToken(token) : null;

  if (decoded?.jti) {
    // Without this the cookie is cleared but the token stays valid, so anyone
    // holding a copy could keep refreshing after the user "logged out".
    await revokeToken(decoded.jti);
  }

  clearCookies(res);
  res.status(200).json(successResponse(null, 'Logged out'));
};

/** GET /api/v1/auth/me */
export const me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const auth = req.user!;

    const select = {
      id: true,
      name: true,
      email: true,
      role: true,
      schoolId: true,
      avatarUrl: true,
    } as const;

    const user = auth.schoolId
      ? await withTenant(auth.schoolId, (tx) =>
          tx.user.findUnique({
            where: { id: auth.userId },
            select: { ...select, school: { select: { schoolCode: true, name: true, primaryColor: true, logoUrl: true } } },
          })
        )
      : await asSuperAdmin((tx) => tx.user.findUnique({ where: { id: auth.userId }, select }));

    if (!user) {
      res.status(404).json(errorResponse('User not found'));
      return;
    }

    res.status(200).json(successResponse(user, 'Profile fetched'));
  } catch (error) {
    next(error);
  }
};
