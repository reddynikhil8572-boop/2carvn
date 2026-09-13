import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Transaction-scoped Prisma client. Every query issued through this runs with
 * the tenant GUCs set, so RLS applies.
 */
export type TenantClient = Prisma.TransactionClient;

/**
 * The ONLY place in the codebase permitted to set app.current_school_id or
 * app.is_super_admin. Both are set on every transaction — never one without
 * the other — so a value cannot be inherited from whatever ran before on the
 * same pooled connection.
 *
 * `set_config(..., true)` is the function form of SET LOCAL: it takes bound
 * parameters (no string interpolation into SQL) and is scoped to the
 * surrounding transaction, which is what makes reuse across requests safe.
 */
const applyTenantGucs = async (
  tx: Prisma.TransactionClient,
  schoolId: string | null,
  isSuperAdmin: boolean
): Promise<void> => {
  await tx.$executeRaw`SELECT set_config('app.current_school_id', ${schoolId ?? ''}, true)`;
  await tx.$executeRaw`SELECT set_config('app.is_super_admin', ${isSuperAdmin ? 'on' : 'off'}, true)`;
};

/**
 * Run `fn` scoped to a single school. Anything it reads or writes outside that
 * school is invisible to it — enforced by Postgres, not by this function.
 *
 * @throws if schoolId is not a UUID. Belt and braces: the value comes from a
 * signed JWT, but a malformed one should fail loudly here rather than produce
 * a confusing database error.
 */
export const withTenant = async <T>(
  schoolId: string,
  fn: (tx: TenantClient) => Promise<T>
): Promise<T> => {
  if (!UUID_RE.test(schoolId)) {
    throw Object.assign(new Error('Invalid tenant identifier'), { statusCode: 400 });
  }

  return prisma.$transaction(async (tx) => {
    await applyTenantGucs(tx, schoolId, false);
    return await fn(tx);
  });
};

/**
 * Run `fn` with RLS bypassed, for platform-owner operations that legitimately
 * span tenants — creating a school, listing all schools.
 *
 * Call sites must be gated by requireRole(['SUPER_ADMIN']). Reach for
 * withTenant() unless the operation genuinely cannot be scoped to one school.
 */
export const asSuperAdmin = async <T>(fn: (tx: TenantClient) => Promise<T>): Promise<T> =>
  prisma.$transaction(async (tx) => {
    await applyTenantGucs(tx, null, true);
    return await fn(tx);
  });

/**
 * Run `fn` with no tenant and no bypass — every RLS-protected table returns
 * nothing. Used by the unauthenticated login path, which must resolve a school
 * code and a user *before* a tenant is known.
 *
 * Because RLS would hide those rows, the queries inside deliberately use
 * `$queryRaw` against a SECURITY DEFINER lookup function rather than the
 * ordinary client. See src/services/auth.service.ts.
 */
export const withoutTenant = async <T>(fn: (tx: TenantClient) => Promise<T>): Promise<T> =>
  prisma.$transaction(async (tx) => {
    await applyTenantGucs(tx, null, false);
    return await fn(tx);
  });
