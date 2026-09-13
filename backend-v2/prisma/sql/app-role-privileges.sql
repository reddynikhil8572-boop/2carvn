-- The authoritative, re-runnable definition of what `edusphere_app` may do.
--
-- WHY THIS FILE EXISTS
--
-- `pg_dump` emits database objects, not cluster roles, and backup.sh dumps with
-- --no-owner --no-privileges — so a restored database contains every row and
-- **not one GRANT**. Measured during the 2026-08-06 restore rehearsal: the
-- source had 102 table grants for edusphere_app, the restore had 0.
--
-- The migrations cannot fix that. `prisma migrate deploy` reads the restored
-- `_prisma_migrations` table, sees all 13 already applied, and does nothing.
--
-- Re-running the grants by hand is worse than doing nothing, because the
-- privilege model is not additive: it is spread across seven migrations and
-- ends with a REVOKE. `GRANT ... ON ALL TABLES` re-grants DELETE on
-- video_events and quietly destroys the append-only guarantee that exists so
-- nobody can rewrite a student's viewing history. The restore would come up
-- looking healthy with a security property missing.
--
-- So the end state is stated once, here, in the order that produces it.
--
-- KEEPING IT HONEST: any future migration that grants or revokes anything to
-- edusphere_app must be reflected here, or the next restore comes up with
-- privileges that differ from the database it was taken from.
-- `tests/appRolePrivileges.test.ts` fails if the two drift apart.
--
--   psql --dbname="$OWNER_URL" -v ON_ERROR_STOP=1 -f prisma/sql/app-role-privileges.sql
--
-- Must be run as the object owner. Idempotent; safe to run on a live database.

-- ── The role ────────────────────────────────────────────────────────────────
--
-- Created WITHOUT a password, exactly as 20260802160000_app_role does. A
-- restore must not resurrect a role with a default credential; the password
-- comes from APP_DB_PASSWORD afterwards, via src/scripts/setAppRolePassword.ts.
-- Until then the role cannot authenticate, which is the correct failure mode.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edusphere_app') THEN
    CREATE ROLE edusphere_app LOGIN;
  END IF;
END
$$;

-- Explicit rather than relying on defaults: this role existing without these
-- attributes means RLS is inert and every school can read every other school.
ALTER ROLE edusphere_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- ── Baseline: DML on everything, DDL on nothing ─────────────────────────────
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO edusphere_app', current_database());

  EXECUTE 'GRANT USAGE ON SCHEMA public TO edusphere_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO edusphere_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO edusphere_app';
  EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO edusphere_app';

  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO edusphere_app', current_user);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
    'GRANT USAGE, SELECT ON SEQUENCES TO edusphere_app', current_user);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
    'GRANT EXECUTE ON FUNCTIONS TO edusphere_app', current_user);
END
$$;

-- ── Then the exceptions, which are the whole point ──────────────────────────
--
-- These MUST come after the baseline above. Reversing the order leaves the
-- broad grant in place and nothing complains.

-- Prisma's bookkeeping is Prisma's alone; the application has no business
-- reading, let alone rewriting, which migrations are recorded as applied.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE "_prisma_migrations" FROM edusphere_app';
  END IF;
END
$$;

-- video_events is append-only: it is the record of what a child actually
-- watched, and the application that writes it must not be able to edit or
-- erase it afterwards. Retention pruning therefore runs as the owner, out of
-- band — see k8s/retention-cronjob.yaml and src/scripts/pruneVideoEvents.ts.
DO $$
BEGIN
  IF to_regclass('public.video_events') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON "video_events" FROM edusphere_app';
  END IF;
END
$$;
