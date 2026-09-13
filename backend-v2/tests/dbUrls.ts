/**
 * Connection strings for the test database, derived from whatever is already
 * in the environment so this works unchanged locally (docker compose on 55432)
 * and in CI (a Postgres service on 5432).
 *
 * Computed here rather than assigned in globalSetup because vitest runs test
 * files in separate worker processes; deriving the values in both places is
 * deterministic, whereas relying on env mutation crossing the process boundary
 * is not.
 */
import path from 'node:path';
import dotenv from 'dotenv';

// Load .env before reading anything below.
//
// This is not a convenience. `globalSetup` runs `ALTER ROLE edusphere_app
// PASSWORD ...`, and **roles are cluster-wide, not per-database** — so without
// this the suite would fall back to a made-up password and silently rewrite the
// credential the running containerised API depends on. The API then keeps
// serving from its existing pool and fails minutes later when it opens a new
// connection, which is a genuinely baffling way to break a dev environment.
//
// Ask how I know.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const OWNER_URL =
  process.env.TEST_DIRECT_DATABASE_URL ||
  process.env.DIRECT_DATABASE_URL ||
  'postgresql://edusphere:edusphere@localhost:55432/edusphere?schema=public';

export const TEST_DB = process.env.TEST_DB_NAME || 'edusphere_test';

/**
 * The password `globalSetup` applies to `edusphere_app`.
 *
 * An earlier version of this comment claimed a fixed fallback was safe because
 * it was "only used against the throwaway test database". That was wrong:
 * `ALTER ROLE` is cluster-wide, so the fallback silently changed the password
 * for every database in the cluster, including the development one the compose
 * API is connected to.
 *
 * Taking it from `.env` (loaded above) keeps the role's password stable, so
 * running the suite no longer breaks whatever else is using that role. The
 * literal remains only for CI, where nothing else shares the cluster.
 */
export const APP_PASSWORD = process.env.APP_DB_PASSWORD || 'edusphere_test_password';

const swap = (url: string, database: string, user?: string, password?: string) => {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  if (user) parsed.username = user;
  if (password) parsed.password = password;
  return parsed.toString();
};

/** Owner: used only to create the database and run migrations. */
export const ownerTestUrl = swap(OWNER_URL, TEST_DB);

/**
 * Restricted role: what the application under test connects as. Using the
 * owner here would make every isolation assertion pass vacuously — which is
 * precisely the failure this suite exists to catch.
 */
export const appTestUrl = swap(OWNER_URL, TEST_DB, 'edusphere_app', APP_PASSWORD);
