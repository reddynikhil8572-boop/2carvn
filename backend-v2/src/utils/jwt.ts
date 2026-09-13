import crypto from 'node:crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config/env';

export interface TokenPayload {
  userId: string;
  /**
   * The tenant this session is bound to. Null only for SUPER_ADMIN, who
   * operates across schools. Every tenant-scoped request derives its RLS
   * context from this field — see db/tenantContext.ts.
   */
  schoolId: string | null;
  role: 'SUPER_ADMIN' | 'SCHOOL_ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
  /** Bumping User.tokenVersion invalidates every token already issued. */
  tokenVersion: number;
}

/**
 * Refresh tokens additionally carry a `jti` identifying the stored row, which
 * is what makes rotation and reuse detection possible. Access tokens stay
 * stateless — verifying them must not require a database round trip.
 */
export interface RefreshTokenPayload extends TokenPayload {
  jti: string;
}

export const generateAccessToken = (payload: TokenPayload): string =>
  jwt.sign(payload, config.jwtAccessSecret, {
    expiresIn: config.jwtAccessExpiration as SignOptions['expiresIn'],
  });

export const generateRefreshToken = (payload: RefreshTokenPayload): string =>
  jwt.sign(payload, config.jwtRefreshSecret, {
    expiresIn: config.jwtRefreshExpiration as SignOptions['expiresIn'],
  });

export const verifyAccessToken = (token: string): TokenPayload | null => {
  try {
    return jwt.verify(token, config.jwtAccessSecret) as TokenPayload;
  } catch {
    return null;
  }
};

export const verifyRefreshToken = (token: string): RefreshTokenPayload | null => {
  try {
    return jwt.verify(token, config.jwtRefreshSecret) as RefreshTokenPayload;
  } catch {
    return null;
  }
};

/**
 * Two-factor challenge token.
 *
 * Issued when the password is correct but a second factor is still owed. It
 * proves only "this password was verified moments ago" and authorises exactly
 * one endpoint: POST /auth/2fa/verify.
 *
 * Signed with a key *derived* from the access secret rather than the access
 * secret itself. Sharing the key and separating the two with a `typ` claim
 * works only for as long as every verifier remembers to check that claim; a
 * distinct key means a challenge token simply fails signature verification
 * anywhere an access token is expected, with no discipline required.
 */
const challengeSecret = crypto
  .createHmac('sha256', config.jwtAccessSecret)
  .update('edusphere:2fa-challenge:v1')
  .digest();

/** Short by design: it is a step in a login, not a session. */
export const CHALLENGE_TTL_SECONDS = 5 * 60;

export interface ChallengePayload {
  userId: string;
  /** Bound to the version current at password check, so a revocation mid-login is caught. */
  tokenVersion: number;
}

export const generateChallengeToken = (payload: ChallengePayload): string =>
  jwt.sign(payload, challengeSecret, { expiresIn: CHALLENGE_TTL_SECONDS });

export const verifyChallengeToken = (token: string): ChallengePayload | null => {
  try {
    return jwt.verify(token, challengeSecret) as ChallengePayload;
  } catch {
    return null;
  }
};
