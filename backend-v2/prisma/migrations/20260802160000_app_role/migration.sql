-- RLS is silently inert when the connecting role is a superuser: superusers
-- bypass every policy, and FORCE ROW LEVEL SECURITY does not change that.
-- POSTGRES_USER is the cluster bootstrap superuser, so connecting the app as
-- it meant the policies added in 20260802153000 had no effect whatsoever.
--
-- Split the roles:
--   edusphere      — superuser, owns the objects, runs migrations (directUrl)
--   edusphere_app  — NOSUPERUSER NOBYPASSRLS, what the application connects as
--
-- The role is created WITHOUT a password. A credential committed to a
-- migration is a credential in every clone, CI log and fork forever, and
-- "rotate it in production" is a step people forget. Instead the password is
-- applied from APP_DB_PASSWORD after migrations run — see scripts/set-app-role-password.ts,
-- which the compose `migrate` service invokes.
--
-- Until that runs the role cannot authenticate at all, which is the correct
-- failure mode: no password means no access, not a default one.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edusphere_app') THEN
    CREATE ROLE edusphere_app LOGIN;
  END IF;
END
$$;

-- Explicit, even though these are the defaults for a fresh role: the whole
-- point of this role is that it cannot escape RLS.
ALTER ROLE edusphere_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- The database name and the owning role differ between environments — a local
-- container, a CI service, and a managed instance rarely agree. Resolve both
-- at run time rather than hardcoding, so this migration applies anywhere.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO edusphere_app', current_database());

  -- DML only. No DDL: the application must never alter its own schema, and in
  -- particular must never be able to DROP a policy.
  EXECUTE 'GRANT USAGE ON SCHEMA public TO edusphere_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO edusphere_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO edusphere_app';
  EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO edusphere_app';

  -- Objects created by later migrations belong to whoever runs them, so grant
  -- them to the app role automatically rather than relying on every future
  -- migration remembering to.
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

-- The migration bookkeeping table is Prisma's alone. Guarded because Prisma's
-- shadow database replays migrations before that table exists there, and an
-- unconditional REVOKE fails the whole shadow check.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE "_prisma_migrations" FROM edusphere_app';
  END IF;
END
$$;
