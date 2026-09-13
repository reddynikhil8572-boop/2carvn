import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { OWNER_URL, TEST_DB, ownerTestUrl, APP_PASSWORD } from './dbUrls';

/**
 * Creates a dedicated test database and migrates it, so the suite never
 * touches development data.
 */

const dropIfExists = async (client: Client) => {
  // Terminate stragglers first: DROP DATABASE fails while any session is
  // still attached, and a crashed previous run can leave one behind.
  await client.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [TEST_DB]
  );
  await client.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
};

export default async function setup() {
  const admin = new Client({ connectionString: OWNER_URL });
  await admin.connect();

  // Recreate from scratch every run. A suite that depends on leftover state
  // from the last run is a suite that can pass for the wrong reasons.
  await dropIfExists(admin);
  await admin.query(`CREATE DATABASE "${TEST_DB}"`);
  await admin.end();

  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: ownerTestUrl, DIRECT_DATABASE_URL: ownerTestUrl },
  });

  // The migration creates edusphere_app without a password on purpose, so it
  // cannot authenticate until one is applied. Roles are cluster-wide, so this
  // is idempotent across runs, but CI starts from a bare Postgres where
  // nothing else would have set it.
  const owner = new Client({ connectionString: ownerTestUrl });
  await owner.connect();
  const { rows } = await owner.query<{ sql: string }>(
    'SELECT format($fmt$ALTER ROLE %I PASSWORD %L$fmt$, $1::text, $2::text) AS sql',
    ['edusphere_app', APP_PASSWORD]
  );
  await owner.query(rows[0]!.sql);
  await owner.end();

  return async () => {
    const cleanup = new Client({ connectionString: OWNER_URL });
    await cleanup.connect();
    await dropIfExists(cleanup);
    await cleanup.end();
  };
}
