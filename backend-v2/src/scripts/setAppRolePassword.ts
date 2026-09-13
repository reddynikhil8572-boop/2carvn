/**
 * Applies APP_DB_PASSWORD to the restricted application role.
 *
 * Runs after `prisma migrate deploy`, as the owning role. The migration that
 * creates `edusphere_app` deliberately gives it no password, so this is what
 * makes the role usable — and it keeps the credential in the environment
 * rather than committed to a migration where it would live in every clone,
 * CI log and fork forever.
 *
 * Lives under src/ so it is compiled into dist/ and available in the runtime
 * image, and uses Prisma rather than `pg` so it needs no extra dependency.
 */
import { PrismaClient } from '@prisma/client';

const ROLE = 'edusphere_app';
const MIN_LENGTH = 12;

const fail = (message: string): never => {
  console.error(`FATAL: ${message}`);
  process.exit(1);
};

(async () => {
  // Must be the owner: the app role cannot alter itself.
  const ownerUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  const password = process.env.APP_DB_PASSWORD;

  if (!ownerUrl) fail('DIRECT_DATABASE_URL (or DATABASE_URL) is required');
  if (!password) fail('APP_DB_PASSWORD is required');
  if (password!.length < MIN_LENGTH) {
    fail(`APP_DB_PASSWORD must be at least ${MIN_LENGTH} characters`);
  }

  const prisma = new PrismaClient({ datasourceUrl: ownerUrl });

  try {
    const exists = await prisma.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok FROM pg_roles WHERE rolname = ${ROLE}
    `;
    if (exists.length === 0) {
      fail(`role ${ROLE} does not exist — run migrations first`);
    }

    // ALTER ROLE will not accept a bound parameter for the password, so the
    // statement has to be assembled as text. Let Postgres escape it with
    // format(%I, %L) rather than interpolating in JavaScript — a password
    // containing a quote would otherwise be an injection vector.
    const [built] = await prisma.$queryRaw<{ sql: string }[]>`
      SELECT format($fmt$ALTER ROLE %I PASSWORD %L$fmt$, ${ROLE}::text, ${password}::text) AS sql
    `;
    await prisma.$executeRawUnsafe(built!.sql);

    console.log(`Password applied to role ${ROLE}.`);
  } finally {
    await prisma.$disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
