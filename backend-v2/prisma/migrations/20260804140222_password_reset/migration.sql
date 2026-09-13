-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("token_hash")
);

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Password reset is the third bootstrap flow, and the least authenticated one:
-- the caller has no session, no tenant, and by definition no working password.
-- Same treatment as login and 2FA — narrow SECURITY DEFINER functions rather
-- than a role that can read the users table.
-- ---------------------------------------------------------------------------

-- Finds the account a reset request refers to. Returns nothing sensitive: no
-- password hash, and the caller learns nothing it did not already supply,
-- because the endpoint answers identically whether or not a row came back.
CREATE OR REPLACE FUNCTION app_reset_lookup(p_school_code text, p_email text)
RETURNS TABLE (
  user_id       uuid,
  full_name     text,
  email         text,
  status        "UserStatus",
  school_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.is_super_admin', 'on', true);

  IF p_school_code IS NULL OR p_school_code = '' THEN
    RETURN QUERY
      SELECT u.id, u.name, u.email, u.status, true
      FROM users u
      WHERE u.school_id IS NULL
        AND u.role = 'SUPER_ADMIN'
        AND lower(u.email) = lower(p_email);
  ELSE
    RETURN QUERY
      SELECT u.id, u.name, u.email, u.status, s.is_active
      FROM users u
      JOIN schools s ON s.id = u.school_id
      WHERE upper(s.school_code) = upper(p_school_code)
        AND lower(u.email) = lower(p_email);
  END IF;

  PERFORM set_config('app.is_super_admin', 'off', true);
END;
$$;

-- Applies a new password.
--
-- token_version is bumped in the same statement, which is what actually ends
-- the other sessions: refresh re-reads it and any token minted under the old
-- value stops working. Clearing the lockout matters too — someone who was
-- locked out and reset their password must be able to sign in immediately,
-- otherwise the reset appears not to have worked.
CREATE OR REPLACE FUNCTION app_reset_password(p_user_id uuid, p_password_hash text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.is_super_admin', 'on', true);
  UPDATE users
     SET password_hash  = p_password_hash,
         token_version  = token_version + 1,
         login_attempts = 0,
         lock_until     = NULL
   WHERE id = p_user_id;
  PERFORM set_config('app.is_super_admin', 'off', true);
END;
$$;

GRANT EXECUTE ON FUNCTION app_reset_lookup(text, text) TO edusphere_app;
GRANT EXECUTE ON FUNCTION app_reset_password(uuid, text) TO edusphere_app;

-- Name and address for a user id, for sending a notification when there is no
-- session to read them from. Nothing here is a secret the caller could not
-- already obtain, but it still goes through a definer function because the
-- users table is under RLS and this runs with no tenant context.
CREATE OR REPLACE FUNCTION app_user_contact(p_user_id uuid)
RETURNS TABLE (full_name text, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.is_super_admin', 'on', true);
  RETURN QUERY SELECT u.name, u.email FROM users u WHERE u.id = p_user_id;
  PERFORM set_config('app.is_super_admin', 'off', true);
END;
$$;

GRANT EXECUTE ON FUNCTION app_user_contact(uuid) TO edusphere_app;
