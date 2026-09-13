-- AlterTable
ALTER TABLE "users" ADD COLUMN     "two_factor_enabled_at" TIMESTAMP(3),
ADD COLUMN     "two_factor_last_step" BIGINT,
ADD COLUMN     "two_factor_secret" TEXT;

-- CreateTable
CREATE TABLE "recovery_codes" (
    "code_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("code_hash")
);

-- CreateIndex
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes"("user_id");

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Two-factor verification is a second bootstrap problem.
--
-- Between the password check and the second factor there is still no session,
-- so no tenant GUC, so RLS hides the `users` row holding the TOTP seed. The
-- same answer as login applies: narrow SECURITY DEFINER functions that expose
-- exactly the columns this one step needs, rather than a role that can read
-- everything.
-- ---------------------------------------------------------------------------

-- app_login_lookup gains a two_factor_enabled flag so the password step knows
-- whether to issue a session or a challenge. Return types are immutable in
-- Postgres, so the old signature has to go first.
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
      SELECT u.id, u.school_id, u.password_hash, u.role, u.status,
             u.token_version, u.login_attempts, u.lock_until, u.name, true,
             (u.two_factor_enabled_at IS NOT NULL)
      FROM users u
      WHERE u.school_id IS NULL
        AND u.role = 'SUPER_ADMIN'
        AND lower(u.email) = lower(p_email);
  ELSE
    RETURN QUERY
      SELECT u.id, u.school_id, u.password_hash, u.role, u.status,
             u.token_version, u.login_attempts, u.lock_until, u.name, s.is_active,
             (u.two_factor_enabled_at IS NOT NULL)
      FROM users u
      JOIN schools s ON s.id = u.school_id
      WHERE upper(s.school_code) = upper(p_school_code)
        AND lower(u.email) = lower(p_email);
  END IF;

  PERFORM set_config('app.is_super_admin', 'off', true);
END;
$$;

-- Reads what verifying a code requires, and nothing else. In particular it is
-- keyed by user id only — the caller must already hold a challenge token, which
-- is only issued after a correct password.
CREATE OR REPLACE FUNCTION app_2fa_lookup(p_user_id uuid)
RETURNS TABLE (
  secret        text,
  last_step     bigint,
  enabled       boolean,
  school_id     uuid,
  role          "UserRole",
  status        "UserStatus",
  token_version integer,
  full_name     text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.is_super_admin', 'on', true);
  RETURN QUERY
    SELECT u.two_factor_secret, u.two_factor_last_step,
           (u.two_factor_enabled_at IS NOT NULL),
           u.school_id, u.role, u.status, u.token_version, u.name
    FROM users u
    WHERE u.id = p_user_id;
  PERFORM set_config('app.is_super_admin', 'off', true);
END;
$$;

-- Records the accepted time step. The guard is what makes a code single-use:
-- two requests racing with the same code both pass verification in the
-- application, but only the first moves the watermark, and the UPDATE ... WHERE
-- reports zero rows to the loser.
CREATE OR REPLACE FUNCTION app_2fa_record_step(p_user_id uuid, p_step bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated integer;
BEGIN
  PERFORM set_config('app.is_super_admin', 'on', true);
  UPDATE users
     SET two_factor_last_step = p_step
   WHERE id = p_user_id
     AND (two_factor_last_step IS NULL OR two_factor_last_step < p_step);
  GET DIAGNOSTICS updated = ROW_COUNT;
  PERFORM set_config('app.is_super_admin', 'off', true);
  RETURN updated > 0;
END;
$$;

-- Spends a recovery code. Returns false if it does not exist or was already
-- used; the UPDATE ... WHERE used_at IS NULL makes that atomic, so a code
-- submitted twice concurrently is accepted exactly once.
CREATE OR REPLACE FUNCTION app_2fa_consume_recovery(p_user_id uuid, p_code_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated integer;
BEGIN
  UPDATE recovery_codes
     SET used_at = now()
   WHERE user_id = p_user_id
     AND code_hash = p_code_hash
     AND used_at IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$;

-- Functions created by this migration belong to the owner; the app role needs
-- to call them. ALTER DEFAULT PRIVILEGES in 20260802160000_app_role covers
-- this, but only for objects created by the role that ran that migration —
-- state it explicitly rather than depend on the two matching.
GRANT EXECUTE ON FUNCTION app_login_lookup(text, text) TO edusphere_app;
GRANT EXECUTE ON FUNCTION app_2fa_lookup(uuid) TO edusphere_app;
GRANT EXECUTE ON FUNCTION app_2fa_record_step(uuid, bigint) TO edusphere_app;
GRANT EXECUTE ON FUNCTION app_2fa_consume_recovery(uuid, text) TO edusphere_app;

-- Enrollment mutations. These run from authenticated requests, but the acting
-- user may be a SUPER_ADMIN with no school, so there is no single tenant GUC
-- that covers both cases. Keyed strictly by user id, and every caller passes
-- req.user.userId — none of them can be aimed at another account.

CREATE OR REPLACE FUNCTION app_2fa_set_secret(p_user_id uuid, p_secret text, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.is_super_admin', 'on', true);
  UPDATE users
     SET two_factor_secret     = p_secret,
         two_factor_enabled_at = CASE WHEN p_enabled THEN now() ELSE NULL END,
         -- A new secret starts a new step sequence; carrying the old watermark
         -- over would reject the first codes from the new authenticator.
         two_factor_last_step  = NULL
   WHERE id = p_user_id;
  PERFORM set_config('app.is_super_admin', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION app_2fa_enable(p_user_id uuid, p_step bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.is_super_admin', 'on', true);
  UPDATE users
     SET two_factor_enabled_at = now(),
         two_factor_last_step  = p_step
   WHERE id = p_user_id
     AND two_factor_secret IS NOT NULL;
  PERFORM set_config('app.is_super_admin', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION app_2fa_disable(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.is_super_admin', 'on', true);
  UPDATE users
     SET two_factor_secret     = NULL,
         two_factor_enabled_at = NULL,
         two_factor_last_step  = NULL
   WHERE id = p_user_id;
  PERFORM set_config('app.is_super_admin', 'off', true);
END;
$$;

GRANT EXECUTE ON FUNCTION app_2fa_set_secret(uuid, text, boolean) TO edusphere_app;
GRANT EXECUTE ON FUNCTION app_2fa_enable(uuid, bigint) TO edusphere_app;
GRANT EXECUTE ON FUNCTION app_2fa_disable(uuid) TO edusphere_app;
