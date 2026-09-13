/**
 * Bootstraps the platform owner. Everything else in the system is created
 * through the API, so this is the only account that cannot be.
 *
 *   npm run seed
 *
 * Credentials come from SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD.
 *
 * The development fallback is **refused when NODE_ENV=production**. A warning is
 * not enough: this account is the platform owner, its password is committed in
 * plain sight, and a warning printed once during a deploy is a warning nobody
 * reads. Refusing to seed is recoverable in seconds; a known-credential owner
 * account reachable from the internet is not.
 */
import { prisma } from '../db/prisma';
import { asSuperAdmin } from '../db/tenantContext';
import { hashPassword } from '../services/auth.service';

const DEV_FALLBACK_PASSWORD = 'ChangeMe!2026';

const EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL || 'owner@edusphere.local';
const PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD || '';

// The same boundary config/env.ts uses for ENCRYPTION_KEY and SMTP_HOST:
// production is opt-in via NODE_ENV, everything else is treated as local. Being
// consistent matters more than being maximally strict here — a seed script that
// refuses to run on a developer's machine gets worked around, and a worked-around
// check protects nobody.
//
// Residual gap, stated rather than papered over: a real host that forgets to set
// NODE_ENV=production would still accept the fallback. The compose stack sets it
// explicitly, and seeding is a manual act rather than part of the migrate
// service, so this is a narrow window — but it is a window.
const isProduction = process.env.NODE_ENV === 'production';

if (!PASSWORD && isProduction) {
  console.error(
    'FATAL: SEED_SUPER_ADMIN_PASSWORD is required when NODE_ENV=production.\n' +
      'Generate one with: openssl rand -base64 24'
  );
  process.exit(1);
}

const effectivePassword = PASSWORD || DEV_FALLBACK_PASSWORD;

(async () => {
  const existing = await asSuperAdmin((tx) =>
    tx.user.findFirst({ where: { role: 'SUPER_ADMIN', email: EMAIL } })
  );

  if (existing) {
    console.log(`Super admin already present: ${EMAIL}`);
  } else {
    const passwordHash = await hashPassword(effectivePassword);
    await asSuperAdmin((tx) =>
      tx.user.create({
        data: {
          email: EMAIL,
          passwordHash,
          name: 'Platform Owner',
          role: 'SUPER_ADMIN',
          schoolId: null,
        },
      })
    );
    console.log(`Created super admin: ${EMAIL}`);
  }

  if (effectivePassword === DEV_FALLBACK_PASSWORD) {
    console.warn(
      'WARNING: using the development seed password. Refused when ' +
        'NODE_ENV=production — set SEED_SUPER_ADMIN_PASSWORD before any shared use.'
    );
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
