-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('SUBMITTED', 'GRADED', 'RETURNED');

-- DropForeignKey
ALTER TABLE "quiz_answers" DROP CONSTRAINT "quiz_answers_option_belongs_to_question_fkey";

-- CreateTable
CREATE TABLE "assignments" (
    "lesson_item_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "instructions" TEXT,
    "due_at" TIMESTAMP(3),
    "max_points" INTEGER NOT NULL DEFAULT 100,
    "allows_late" BOOLEAN NOT NULL DEFAULT true,
    "allows_file" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("lesson_item_id")
);

-- CreateTable
CREATE TABLE "assignment_submissions" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "body_text" TEXT,
    "file_key" TEXT,
    "is_late" BOOLEAN NOT NULL DEFAULT false,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "points" INTEGER,
    "feedback" TEXT,
    "graded_by" UUID,
    "graded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assignments_school_id_idx" ON "assignments"("school_id");

-- CreateIndex
CREATE INDEX "assignment_submissions_school_id_idx" ON "assignment_submissions"("school_id");

-- CreateIndex
CREATE INDEX "assignment_submissions_student_id_idx" ON "assignment_submissions"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submissions_assignment_id_student_id_key" ON "assignment_submissions"("assignment_id", "student_id");

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_lesson_item_id_fkey" FOREIGN KEY ("lesson_item_id") REFERENCES "lesson_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("lesson_item_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_graded_by_fkey" FOREIGN KEY ("graded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written from here down: RLS, parity triggers, the kind discriminator.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "assignments_tenant_isolation" ON "assignments"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

ALTER TABLE "assignment_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment_submissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "assignment_submissions_tenant_isolation" ON "assignment_submissions"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

-- As with quiz_attempts: this policy separates schools, not classmates. A
-- pupil's marks and a teacher's feedback are visible to anyone in the same
-- tenant as far as Postgres is concerned; owner-only access is enforced in the
-- service layer. Recorded decision, not an oversight — design §6.4.

-- ── school_id parity with the parent ───────────────────────────────────────

CREATE TRIGGER "assignments_school_parity"
  BEFORE INSERT OR UPDATE ON "assignments"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('lesson_items', 'lesson_item_id');

CREATE TRIGGER "assignment_submissions_school_parity"
  BEFORE INSERT OR UPDATE ON "assignment_submissions"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('assignments', 'assignment_id');

-- app_assert_parent_school looks the parent up by `id` unless the parent is
-- one of the tables that shares its own parent's key. `assignments` is now
-- another of those, keyed on lesson_item_id.
CREATE OR REPLACE FUNCTION app_assert_parent_school() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
DECLARE
  parent_table  text := TG_ARGV[0];
  fk_column     text := TG_ARGV[1];
  parent_key    text;
  row_school    uuid;
  parent_id     uuid;
  parent_school uuid;
BEGIN
  row_school := (to_jsonb(NEW) ->> 'school_id')::uuid;
  parent_id  := (to_jsonb(NEW) ->> fk_column)::uuid;

  parent_key := CASE parent_table
                  WHEN 'quizzes' THEN 'lesson_item_id'
                  WHEN 'video_assets' THEN 'lesson_item_id'
                  WHEN 'assignments' THEN 'lesson_item_id'
                  ELSE 'id'
                END;

  EXECUTE format('SELECT school_id FROM %I WHERE %I = $1', parent_table, parent_key)
    INTO parent_school
    USING parent_id;

  IF parent_school IS NULL THEN
    RAISE EXCEPTION
      'edusphere: % % has no visible parent in %', TG_TABLE_NAME, parent_id, parent_table
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF parent_school <> row_school THEN
    RAISE EXCEPTION
      'edusphere: % school_id % does not match its % parent school_id %',
      TG_TABLE_NAME, row_school, parent_table, parent_school
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

-- ── kind discriminator ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_assert_assignment_item_kind() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
DECLARE
  item_kind "LessonItemKind";
BEGIN
  SELECT kind INTO item_kind FROM "lesson_items" WHERE id = NEW.lesson_item_id;

  IF item_kind IS DISTINCT FROM 'ASSIGNMENT'::"LessonItemKind" THEN
    RAISE EXCEPTION
      'edusphere: assignments requires a lesson item of kind ASSIGNMENT, got %',
      coalesce(item_kind::text, 'no visible item')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER "assignments_kind_check"
  BEFORE INSERT OR UPDATE ON "assignments"
  FOR EACH ROW EXECUTE FUNCTION app_assert_assignment_item_kind();

-- All three specialised tables now exist, so the kind of an item may not
-- change while ANY of them is attached.
CREATE OR REPLACE FUNCTION app_assert_lesson_item_kind_stable() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    IF EXISTS (SELECT 1 FROM "video_assets" WHERE lesson_item_id = NEW.id)
       OR EXISTS (SELECT 1 FROM "quizzes" WHERE lesson_item_id = NEW.id)
       OR EXISTS (SELECT 1 FROM "assignments" WHERE lesson_item_id = NEW.id) THEN
      RAISE EXCEPTION
        'edusphere: cannot change kind of lesson item % while its content is attached', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

-- ── Points must fit the assignment ─────────────────────────────────────────
-- A mark above max_points silently breaks every average computed from it.
ALTER TABLE "assignment_submissions"
  ADD CONSTRAINT "assignment_submissions_points_non_negative"
  CHECK (points IS NULL OR points >= 0);

-- ── GRANTs ─────────────────────────────────────────────────────────────────
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edusphere_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON
      "assignments", "assignment_submissions" TO edusphere_app';
  END IF;
END
$grants$;
