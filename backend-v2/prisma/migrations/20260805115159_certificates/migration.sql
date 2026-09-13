-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "serial" TEXT NOT NULL,
    "course_title" TEXT NOT NULL,
    "student_name" TEXT NOT NULL,
    "school_name" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" UUID NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "certificates_serial_key" ON "certificates"("serial");

-- CreateIndex
CREATE INDEX "certificates_school_id_idx" ON "certificates"("school_id");

-- CreateIndex
CREATE INDEX "certificates_course_id_student_id_idx" ON "certificates"("course_id", "student_id");

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written from here down: RLS, the parity trigger, the partial unique
-- index, and the one SECURITY DEFINER function public verification needs.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "certificates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "certificates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "certificates_tenant_isolation" ON "certificates"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

CREATE TRIGGER "certificates_school_parity"
  BEFORE INSERT OR UPDATE ON "certificates"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('courses', 'course_id');

-- ── One LIVE certificate per student per course ────────────────────────────
--
-- Partial, so revoking one does not block reissuing it. Prisma cannot declare
-- a partial unique index, so it lives here — the same reason
-- users_super_admin_email_key does.
CREATE UNIQUE INDEX "certificates_one_live_per_student_course"
  ON "certificates" (course_id, student_id)
  WHERE revoked_at IS NULL;

-- ── Public verification ────────────────────────────────────────────────────
--
-- GET /certificates/:serial is the only route in the system that reads tenant
-- data with no session at all, so it cannot go through RLS: there is no
-- current_school to compare against, and the rows are correctly invisible.
--
-- This is the same bootstrap shape as app_login_lookup, and it gets the same
-- treatment: a narrow SECURITY DEFINER function returning ONLY what a verifier
-- needs. It deliberately exposes no ids, no email, no class, no roster — a
-- verifier is answering "is this credential real", not browsing a school.
--
-- A revoked certificate still resolves, and says so. Telling a verifier "no
-- such certificate" would be a lie that helps the holder of a revoked one.
CREATE OR REPLACE FUNCTION app_certificate_verify(p_serial text)
  RETURNS TABLE (
    serial       text,
    student_name text,
    course_title text,
    school_name  text,
    issued_at    timestamp(3),
    revoked_at   timestamp(3),
    revoke_reason text
  )
  LANGUAGE sql
  SECURITY DEFINER
  -- Pin the search path: a SECURITY DEFINER function that resolves unqualified
  -- names through a caller-controlled search_path is a privilege-escalation
  -- surface.
  SET search_path = public, pg_temp
  STABLE
  AS $$
    SELECT c.serial, c.student_name, c.course_title, c.school_name,
           c.issued_at, c.revoked_at, c.revoke_reason
      FROM certificates c
     WHERE c.serial = p_serial
$$;

REVOKE ALL ON FUNCTION app_certificate_verify(text) FROM PUBLIC;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edusphere_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "certificates" TO edusphere_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION app_certificate_verify(text) TO edusphere_app';
  END IF;
END
$grants$;
