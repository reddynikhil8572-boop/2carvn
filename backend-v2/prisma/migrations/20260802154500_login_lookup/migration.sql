-- Login is a bootstrap problem: RLS hides the very rows authentication needs.
-- To find a user we must first resolve their school code, but `schools` and
-- `users` are both tenant-scoped, and at login there is no tenant yet.
--
-- The options were a second database role with BYPASSRLS (extra connection
-- string, extra pool) or a narrow SECURITY DEFINER function. This is the
-- function: it is the single sanctioned bypass, it takes only a school code
-- and an email, and it returns only the columns authentication needs. It
-- cannot be repurposed to read arbitrary tenant data.
--
-- The super-admin GUC is raised and lowered inside the function body, so it is
-- never observable by the caller's transaction after the function returns.

CREATE OR REPLACE FUNCTION app_login_lookup(p_school_code text, p_email text)
RETURNS TABLE (
  user_id        uuid,
  school_id      uuid,
  password_hash  text,
  role           "UserRole",
  status         "UserStatus",
  token_version  integer,
  login_attempts integer,
  lock_until     timestamp(3),
  full_name      text,
  school_active  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.is_super_admin', 'on', true);

  IF p_school_code IS NULL OR p_school_code = '' THEN
    -- Platform owner: no school code, and the account must have no school.
    RETURN QUERY
      SELECT u.id, u.school_id, u.password_hash, u.role, u.status,
             u.token_version, u.login_attempts, u.lock_until, u.name, true
      FROM users u
      WHERE u.school_id IS NULL
        AND u.role = 'SUPER_ADMIN'
        AND lower(u.email) = lower(p_email);
  ELSE
    RETURN QUERY
      SELECT u.id, u.school_id, u.password_hash, u.role, u.status,
             u.token_version, u.login_attempts, u.lock_until, u.name, s.is_active
      FROM users u
      JOIN schools s ON s.id = u.school_id
      WHERE upper(s.school_code) = upper(p_school_code)
        AND lower(u.email) = lower(p_email);
  END IF;

  -- Lower the flag before returning so it cannot bleed into the caller's
  -- remaining statements within the same transaction.
  PERFORM set_config('app.is_super_admin', 'off', true);
END;
$$;

-- Counters must be updatable before a tenant context exists (a failed login
-- has no session). Same containment rules as above.
CREATE OR REPLACE FUNCTION app_record_login_failure(p_user_id uuid, p_lock_until timestamp(3))
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.is_super_admin', 'on', true);
  UPDATE users
     SET login_attempts = CASE WHEN p_lock_until IS NULL THEN login_attempts + 1 ELSE 0 END,
         lock_until     = p_lock_until
   WHERE id = p_user_id;
  PERFORM set_config('app.is_super_admin', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION app_record_login_success(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.is_super_admin', 'on', true);
  UPDATE users
     SET login_attempts = 0, lock_until = NULL, last_login_at = now()
   WHERE id = p_user_id;
  PERFORM set_config('app.is_super_admin', 'off', true);
END;
$$;
