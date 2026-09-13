-- Row-Level Security: the tenant boundary.
--
-- Application code scopes queries by school_id, but that fails OPEN — one
-- forgotten WHERE clause leaks another school's data. These policies fail
-- CLOSED: with no tenant set, current_school() returns NULL, every
-- `school_id = NULL` comparison yields NULL, and no rows are visible.
--
-- FORCE is essential. The application connects as the table owner, and owners
-- bypass RLS by default; ENABLE alone would be decorative here.
--
-- The only code permitted to set these GUCs is withTenant() in
-- src/db/tenantContext.ts. Both are set on every transaction, so a stale value
-- cannot survive into the next request (SET LOCAL is transaction-scoped).

-- ── helpers ────────────────────────────────────────────────────────────────

-- NULLIF guards the empty string: current_setting returns '' for a GUC that
-- was set and then cleared, and ''::uuid would raise rather than yield NULL.
CREATE OR REPLACE FUNCTION app_current_school() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.current_school_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_is_super_admin() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.is_super_admin', true), 'off') = 'on' $$;

-- ── integrity constraints ──────────────────────────────────────────────────

-- SUPER_ADMIN sits outside any school; everyone else must belong to one.
ALTER TABLE "users"
  ADD CONSTRAINT "users_super_admin_has_no_school"
  CHECK (
    (role = 'SUPER_ADMIN' AND school_id IS NULL)
    OR (role <> 'SUPER_ADMIN' AND school_id IS NOT NULL)
  );

-- Prisma's @@unique([schoolId, email]) does not constrain super admins:
-- Postgres treats NULLs as distinct in unique indexes, so without this a second
-- super admin could reuse an existing address.
CREATE UNIQUE INDEX "users_super_admin_email_key"
  ON "users" (email) WHERE school_id IS NULL;

-- ── policies ───────────────────────────────────────────────────────────────

-- schools: a tenant sees only its own row, keyed on the primary key rather
-- than a school_id column.
ALTER TABLE "schools" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schools" FORCE ROW LEVEL SECURITY;
CREATE POLICY "schools_tenant_isolation" ON "schools"
  USING (app_is_super_admin() OR id = app_current_school())
  WITH CHECK (app_is_super_admin() OR id = app_current_school());

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY "users_tenant_isolation" ON "users"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

ALTER TABLE "classes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "classes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "classes_tenant_isolation" ON "classes"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

ALTER TABLE "enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrollments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "enrollments_tenant_isolation" ON "enrollments"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

ALTER TABLE "parent_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "parent_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY "parent_links_tenant_isolation" ON "parent_links"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

-- audit_logs: append-only. Readable within the tenant, insertable within the
-- tenant, and never updatable or deletable — no policy grants UPDATE or DELETE,
-- so those are denied for everyone including super admins.
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "audit_logs_select" ON "audit_logs" FOR SELECT
  USING (app_is_super_admin() OR school_id = app_current_school());
CREATE POLICY "audit_logs_insert" ON "audit_logs" FOR INSERT
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());
