import bcrypt from 'bcrypt';
import { prisma } from '../db/prisma';
import type { TokenPayload } from '../utils/jwt';

export const BCRYPT_ROUNDS = 10;
export const MAX_LOGIN_ATTEMPTS = 3;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_ROUNDS);

/** Shape returned by the app_login_lookup SECURITY DEFINER function. */
interface LoginRow {
  user_id: string;
  school_id: string | null;
  password_hash: string;
  role: TokenPayload['role'];
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  token_version: number;
  login_attempts: number;
  lock_until: Date | null;
  full_name: string;
  school_active: boolean;
  two_factor_enabled: boolean;
}

export type LoginFailure =
  | { kind: 'invalid' }
  | { kind: 'locked'; retryAfterSeconds: number }
  | { kind: 'suspended' }
  | { kind: 'school_inactive' };

export type LoginResult =
  | { ok: true; payload: TokenPayload; name: string; twoFactorEnabled: boolean }
  | { ok: false; failure: LoginFailure; attemptsRemaining?: number };

/**
 * Authenticate against a school code.
 *
 * Login is the one flow that must read across the RLS boundary — resolving a
 * school code to a tenant necessarily happens before a tenant is known. It
 * goes through app_login_lookup(), a narrow SECURITY DEFINER function that
 * returns only these columns and nothing else. See migration
 * 20260802154500_login_lookup.
 *
 * `schoolCode` is empty for SUPER_ADMIN, who has no school.
 */
export const authenticate = async (
  schoolCode: string,
  email: string,
  password: string
): Promise<LoginResult> => {
  const rows = await prisma.$queryRaw<LoginRow[]>`
    SELECT * FROM app_login_lookup(${schoolCode}, ${email})
  `;

  const row = rows[0];

  // Unknown account: still run a bcrypt comparison so the response time does
  // not reveal whether the email exists.
  if (!row) {
    await bcrypt.compare(password, '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu');
    return { ok: false, failure: { kind: 'invalid' } };
  }

  const now = new Date();

  if (row.lock_until && row.lock_until > now) {
    return {
      ok: false,
      failure: {
        kind: 'locked',
        retryAfterSeconds: Math.ceil((row.lock_until.getTime() - now.getTime()) / 1000),
      },
    };
  }

  if (row.status !== 'ACTIVE') {
    return { ok: false, failure: { kind: 'suspended' } };
  }

  if (!row.school_active) {
    return { ok: false, failure: { kind: 'school_inactive' } };
  }

  const matches = await bcrypt.compare(password, row.password_hash);

  if (!matches) {
    const attempts = row.login_attempts + 1;
    const shouldLock = attempts >= MAX_LOGIN_ATTEMPTS;
    const lockUntil = shouldLock ? new Date(now.getTime() + LOCK_DURATION_MS) : null;

    // Prisma binds a JS Date as `timestamptz`, but the column and the function
    // signature are `timestamp(3)` (Prisma's own mapping for DateTime), so the
    // call fails overload resolution without a cast. `AT TIME ZONE 'UTC'`
    // rather than a bare `::timestamp` because the latter would convert using
    // the session's TimeZone — correct on a UTC container, silently wrong on an
    // instance configured otherwise, and Prisma reads the column back as UTC.
    await prisma.$executeRaw`
      SELECT app_record_login_failure(
        ${row.user_id}::uuid,
        ${lockUntil}::timestamptz AT TIME ZONE 'UTC'
      )`;

    if (shouldLock) {
      return {
        ok: false,
        failure: { kind: 'locked', retryAfterSeconds: Math.ceil(LOCK_DURATION_MS / 1000) },
      };
    }

    return {
      ok: false,
      failure: { kind: 'invalid' },
      attemptsRemaining: MAX_LOGIN_ATTEMPTS - attempts,
    };
  }

  // Clear the failure counters now, not after the second factor. The password
  // was correct; holding the lockout open until a TOTP code arrives would mean
  // a user fumbling their authenticator gets locked out of a password they
  // typed right.
  await prisma.$executeRaw`SELECT app_record_login_success(${row.user_id}::uuid)`;

  return {
    ok: true,
    name: row.full_name,
    twoFactorEnabled: row.two_factor_enabled,
    payload: {
      userId: row.user_id,
      schoolId: row.school_id,
      role: row.role,
      tokenVersion: row.token_version,
    },
  };
};
