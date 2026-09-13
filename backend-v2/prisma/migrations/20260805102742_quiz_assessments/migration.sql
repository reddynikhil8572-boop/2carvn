-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "quizzes" (
    "lesson_item_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "instructions" TEXT,
    "passing_score" INTEGER NOT NULL DEFAULT 60,
    "time_limit_minutes" INTEGER,
    "max_attempts" INTEGER NOT NULL DEFAULT 1,
    "shuffle_questions" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("lesson_item_id")
);

-- CreateTable
CREATE TABLE "quiz_questions" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "prompt" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiz_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_options" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiz_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_attempts" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "points_earned" INTEGER,
    "points_possible" INTEGER,
    "passed" BOOLEAN,
    "integrity_flags" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_answers" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "selected_option_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quizzes_school_id_idx" ON "quizzes"("school_id");

-- CreateIndex
CREATE INDEX "quiz_questions_quiz_id_position_idx" ON "quiz_questions"("quiz_id", "position");

-- CreateIndex
CREATE INDEX "quiz_questions_school_id_idx" ON "quiz_questions"("school_id");

-- CreateIndex
CREATE INDEX "quiz_options_question_id_position_idx" ON "quiz_options"("question_id", "position");

-- CreateIndex
CREATE INDEX "quiz_options_school_id_idx" ON "quiz_options"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_options_question_id_id_key" ON "quiz_options"("question_id", "id");

-- CreateIndex
CREATE INDEX "quiz_attempts_school_id_idx" ON "quiz_attempts"("school_id");

-- CreateIndex
CREATE INDEX "quiz_attempts_student_id_idx" ON "quiz_attempts"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_attempts_quiz_id_student_id_attempt_number_key" ON "quiz_attempts"("quiz_id", "student_id", "attempt_number");

-- CreateIndex
CREATE INDEX "quiz_answers_school_id_idx" ON "quiz_answers"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_answers_attempt_id_question_id_key" ON "quiz_answers"("attempt_id", "question_id");

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_lesson_item_id_fkey" FOREIGN KEY ("lesson_item_id") REFERENCES "lesson_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("lesson_item_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_options" ADD CONSTRAINT "quiz_options_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_options" ADD CONSTRAINT "quiz_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "quiz_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("lesson_item_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "quiz_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "quiz_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_selected_option_id_fkey" FOREIGN KEY ("selected_option_id") REFERENCES "quiz_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written from here down: RLS, parity triggers, the kind discriminator
-- and the composite foreign key Prisma cannot express.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Row-Level Security ─────────────────────────────────────────────────────

ALTER TABLE "quizzes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quizzes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "quizzes_tenant_isolation" ON "quizzes"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

ALTER TABLE "quiz_questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quiz_questions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "quiz_questions_tenant_isolation" ON "quiz_questions"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

ALTER TABLE "quiz_options" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quiz_options" FORCE ROW LEVEL SECURITY;
CREATE POLICY "quiz_options_tenant_isolation" ON "quiz_options"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

ALTER TABLE "quiz_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quiz_attempts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "quiz_attempts_tenant_isolation" ON "quiz_attempts"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

ALTER TABLE "quiz_answers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quiz_answers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "quiz_answers_tenant_isolation" ON "quiz_answers"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

-- NOTE on what these policies do NOT do: they separate schools, not students.
-- quiz_attempts and quiz_answers hold one pupil's grades, and a classmate in
-- the same school passes this policy. Owner-only access is enforced in the
-- service layer for now — a deliberate, recorded decision
-- (docs/PHASE2_COURSE_DESIGN.md §6.4), not an oversight.

-- ── school_id parity with the parent ───────────────────────────────────────
-- Same reasoning as the course tables: school_id is denormalised so the
-- policies stay flat, and it must not be able to drift.

CREATE TRIGGER "quizzes_school_parity"
  BEFORE INSERT OR UPDATE ON "quizzes"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('lesson_items', 'lesson_item_id');

CREATE TRIGGER "quiz_questions_school_parity"
  BEFORE INSERT OR UPDATE ON "quiz_questions"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('quizzes', 'quiz_id');

CREATE TRIGGER "quiz_options_school_parity"
  BEFORE INSERT OR UPDATE ON "quiz_options"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('quiz_questions', 'question_id');

CREATE TRIGGER "quiz_attempts_school_parity"
  BEFORE INSERT OR UPDATE ON "quiz_attempts"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('quizzes', 'quiz_id');

CREATE TRIGGER "quiz_answers_school_parity"
  BEFORE INSERT OR UPDATE ON "quiz_answers"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('quiz_attempts', 'attempt_id');

-- app_assert_parent_school reads `school_id` from the parent, but `quizzes` is
-- keyed on lesson_item_id rather than id, so the generic lookup by `id` would
-- not find it. Patch the function to resolve the key column per table.
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

  -- Tables that share their parent's primary key are keyed on that column
  -- rather than on `id`.
  parent_key := CASE parent_table
                  WHEN 'quizzes' THEN 'lesson_item_id'
                  WHEN 'video_assets' THEN 'lesson_item_id'
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
-- A quizzes row may only hang off a lesson item of kind QUIZ, and the item's
-- kind may not change while one is attached. Mirrors video_assets.

CREATE OR REPLACE FUNCTION app_assert_quiz_item_kind() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
DECLARE
  item_kind "LessonItemKind";
BEGIN
  SELECT kind INTO item_kind FROM "lesson_items" WHERE id = NEW.lesson_item_id;

  IF item_kind IS DISTINCT FROM 'QUIZ'::"LessonItemKind" THEN
    RAISE EXCEPTION
      'edusphere: quizzes requires a lesson item of kind QUIZ, got %',
      coalesce(item_kind::text, 'no visible item')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER "quizzes_kind_check"
  BEFORE INSERT OR UPDATE ON "quizzes"
  FOR EACH ROW EXECUTE FUNCTION app_assert_quiz_item_kind();

CREATE OR REPLACE FUNCTION app_assert_lesson_item_kind_stable() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    IF EXISTS (SELECT 1 FROM "video_assets" WHERE lesson_item_id = NEW.id)
       OR EXISTS (SELECT 1 FROM "quizzes" WHERE lesson_item_id = NEW.id) THEN
      RAISE EXCEPTION
        'edusphere: cannot change kind of lesson item % while its content is attached', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

-- ── An answer's option must belong to that answer's question ───────────────
--
-- The single constraint that makes a whole class of grading bug impossible.
-- Without it, quiz_answers could point at a valid question and a valid option
-- that have nothing to do with each other, and the grader would cheerfully
-- compare them. Prisma cannot express this: it would need `question_id` to
-- participate in two relations at once. So it is declared here, against the
-- @@unique([questionId, id]) that the schema does declare.
ALTER TABLE "quiz_answers"
  ADD CONSTRAINT "quiz_answers_option_belongs_to_question_fkey"
  FOREIGN KEY ("question_id", "selected_option_id")
  REFERENCES "quiz_options" ("question_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── GRANTs ─────────────────────────────────────────────────────────────────
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edusphere_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON
      "quizzes", "quiz_questions", "quiz_options", "quiz_attempts", "quiz_answers"
      TO edusphere_app';
  END IF;
END
$grants$;
