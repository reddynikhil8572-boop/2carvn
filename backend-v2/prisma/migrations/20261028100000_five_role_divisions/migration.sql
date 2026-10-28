-- Migrate to the requested five-role model without granting legacy guardian
-- accounts any coordinator access. Existing PARENT accounts are suspended,
-- have their refresh sessions revoked, and are retained for manual review.
ALTER TABLE "users" DROP CONSTRAINT "users_super_admin_has_no_school";

UPDATE "users"
SET "status" = 'SUSPENDED',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "role" = 'PARENT';

ALTER TYPE "UserRole" RENAME VALUE 'SUPER_ADMIN' TO 'ADMIN';
ALTER TYPE "UserRole" RENAME VALUE 'SCHOOL_ADMIN' TO 'ORGANISER';
ALTER TYPE "UserRole" RENAME VALUE 'PARENT' TO 'COORDINATOR';

-- Role claims in existing access/refresh tokens use the legacy labels.
-- Revoke every refresh family and bump versions so all users re-authenticate
-- against the new role model after deployment.
UPDATE "users"
SET "token_version" = "token_version" + 1,
    "updated_at" = CURRENT_TIMESTAMP;
UPDATE "refresh_tokens"
SET "revoked_at" = CURRENT_TIMESTAMP
WHERE "revoked_at" IS NULL;

ALTER TABLE "users"
  ADD CONSTRAINT "users_admin_has_no_school"
  CHECK (
    ("role" = 'ADMIN' AND "school_id" IS NULL)
    OR ("role" <> 'ADMIN' AND "school_id" IS NOT NULL)
  );

DROP INDEX IF EXISTS "users_super_admin_email_key";
CREATE UNIQUE INDEX "users_admin_email_key"
  ON "users" ("email") WHERE "school_id" IS NULL;

CREATE TABLE "divisions" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "region" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "divisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "divisions_code_check" CHECK (length(btrim("code")) BETWEEN 2 AND 32),
  CONSTRAINT "divisions_name_check" CHECK (length(btrim("name")) BETWEEN 2 AND 160)
);

CREATE UNIQUE INDEX "divisions_code_key" ON "divisions"("code");

ALTER TABLE "schools" ADD COLUMN "division_id" UUID;
CREATE INDEX "schools_division_id_idx" ON "schools"("division_id");
ALTER TABLE "schools"
  ADD CONSTRAINT "schools_division_id_fkey"
  FOREIGN KEY ("division_id") REFERENCES "divisions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "coordinator_divisions" (
  "id" UUID NOT NULL,
  "coordinator_id" UUID NOT NULL,
  "division_id" UUID NOT NULL,
  "assigned_by_id" UUID NOT NULL,
  "revoked_by_id" UUID,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coordinator_divisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coordinator_divisions_active_grant_key"
  ON "coordinator_divisions"("coordinator_id", "division_id")
  WHERE "revoked_at" IS NULL;
CREATE INDEX "coordinator_divisions_coordinator_id_division_id_revoked_at_idx"
  ON "coordinator_divisions"("coordinator_id", "division_id", "revoked_at");
CREATE INDEX "coordinator_divisions_division_id_revoked_at_idx"
  ON "coordinator_divisions"("division_id", "revoked_at");
CREATE INDEX "coordinator_divisions_assigned_by_id_idx"
  ON "coordinator_divisions"("assigned_by_id");
CREATE INDEX "coordinator_divisions_revoked_by_id_idx"
  ON "coordinator_divisions"("revoked_by_id");

ALTER TABLE "coordinator_divisions"
  ADD CONSTRAINT "coordinator_divisions_coordinator_id_fkey"
  FOREIGN KEY ("coordinator_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "coordinator_divisions_division_id_fkey"
  FOREIGN KEY ("division_id") REFERENCES "divisions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "coordinator_divisions_assigned_by_id_fkey"
  FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "coordinator_divisions_revoked_by_id_fkey"
  FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION app_assert_coordinator_division_grant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "users"
    WHERE "id" = NEW."assigned_by_id"
      AND "role" = 'ADMIN'
      AND "school_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'division grants must be made by an Admin'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."revoked_at" IS NULL AND NOT EXISTS (
    SELECT 1 FROM "users"
    WHERE "id" = NEW."coordinator_id"
      AND "role" = 'COORDINATOR'
      AND "status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'division grants require an active coordinator account'
      USING ERRCODE = '23514';
  END IF;

  IF (NEW."revoked_at" IS NULL) <> (NEW."revoked_by_id" IS NULL) THEN
    RAISE EXCEPTION 'division grant revocation timestamp and actor must be set together'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."revoked_by_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "users"
    WHERE "id" = NEW."revoked_by_id"
      AND "role" = 'ADMIN'
      AND "school_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'division grants must be revoked by an Admin'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "coordinator_divisions_assert_roles"
  BEFORE INSERT OR UPDATE ON "coordinator_divisions"
  FOR EACH ROW EXECUTE FUNCTION app_assert_coordinator_division_grant();

ALTER TABLE "divisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "divisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "divisions_admin_only" ON "divisions"
  USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());

ALTER TABLE "coordinator_divisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coordinator_divisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "coordinator_divisions_admin_only" ON "coordinator_divisions"
  USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());

-- Role labels embedded in PL/pgSQL source are text, not enum dependencies;
-- recreate the narrow login lookup so only ADMIN may use the platform login.
DROP FUNCTION IF EXISTS app_login_lookup(text, text);

CREATE FUNCTION app_login_lookup(p_school_code text, p_email text)
RETURNS TABLE (
  user_id            uuid,
  school_id          uuid,
  password_hash      text,
  role               "UserRole",
  status             "UserStatus",
  token_version      integer,
  login_attempts     integer,
  lock_until         timestamp(3),
  full_name          text,
  school_active      boolean,
  two_factor_enabled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.is_super_admin', 'on', true);

  IF p_school_code IS NULL OR p_school_code = '' THEN
    RETURN QUERY
      SELECT u.id, u.school_id, u.password_hash, u.role,
             u.status, u.token_version, u.login_attempts, u.lock_until,
             u.name, true, (u.two_factor_enabled_at IS NOT NULL)
      FROM users u
      WHERE u.school_id IS NULL
        AND u.role = 'ADMIN'
        AND lower(u.email) = lower(p_email);
  ELSE
    RETURN QUERY
      SELECT u.id, u.school_id, u.password_hash, u.role,
             u.status, u.token_version, u.login_attempts, u.lock_until,
             u.name, s.is_active, (u.two_factor_enabled_at IS NOT NULL)
      FROM users u
      JOIN schools s ON s.id = u.school_id
      WHERE upper(s.school_code) = upper(p_school_code)
        AND lower(u.email) = lower(p_email);
  END IF;

  PERFORM set_config('app.is_super_admin', 'off', true);
END;
$$;
