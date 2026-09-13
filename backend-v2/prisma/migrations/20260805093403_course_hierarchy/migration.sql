-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LessonItemKind" AS ENUM ('VIDEO', 'QUIZ', 'ASSIGNMENT');

-- CreateEnum
CREATE TYPE "VideoProvider" AS ENUM ('UPLOAD', 'YOUTUBE', 'VIMEO');

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "subject" TEXT,
    "cover_image_key" TEXT,
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modules" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapters" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_items" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "kind" "LessonItemKind" NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_assets" (
    "lesson_item_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "storage_key" TEXT,
    "provider" "VideoProvider" NOT NULL DEFAULT 'YOUTUBE',
    "external_url" TEXT,
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_assets_pkey" PRIMARY KEY ("lesson_item_id")
);

-- CreateTable
CREATE TABLE "course_assignments" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "courses_school_id_status_idx" ON "courses"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "courses_school_id_slug_key" ON "courses"("school_id", "slug");

-- CreateIndex
CREATE INDEX "modules_course_id_position_idx" ON "modules"("course_id", "position");

-- CreateIndex
CREATE INDEX "modules_school_id_idx" ON "modules"("school_id");

-- CreateIndex
CREATE INDEX "chapters_module_id_position_idx" ON "chapters"("module_id", "position");

-- CreateIndex
CREATE INDEX "chapters_school_id_idx" ON "chapters"("school_id");

-- CreateIndex
CREATE INDEX "lessons_chapter_id_position_idx" ON "lessons"("chapter_id", "position");

-- CreateIndex
CREATE INDEX "lessons_school_id_idx" ON "lessons"("school_id");

-- CreateIndex
CREATE INDEX "lesson_items_lesson_id_position_idx" ON "lesson_items"("lesson_id", "position");

-- CreateIndex
CREATE INDEX "lesson_items_school_id_idx" ON "lesson_items"("school_id");

-- CreateIndex
CREATE INDEX "video_assets_school_id_idx" ON "video_assets"("school_id");

-- CreateIndex
CREATE INDEX "course_assignments_school_id_idx" ON "course_assignments"("school_id");

-- CreateIndex
CREATE INDEX "course_assignments_class_id_idx" ON "course_assignments"("class_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_assignments_course_id_class_id_key" ON "course_assignments"("course_id", "class_id");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modules" ADD CONSTRAINT "modules_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modules" ADD CONSTRAINT "modules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_items" ADD CONSTRAINT "lesson_items_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_items" ADD CONSTRAINT "lesson_items_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_lesson_item_id_fkey" FOREIGN KEY ("lesson_item_id") REFERENCES "lesson_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written from here down. Prisma cannot express RLS, triggers or GRANTs,
-- so everything that makes these tables safe lives below and must be kept in
-- step with prisma/schema.prisma by hand.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Row-Level Security ─────────────────────────────────────────────────────
--
-- The same flat policy every tenant-scoped table already uses, reusing
-- app_current_school() / app_is_super_admin() from
-- 20260802153000_row_level_security. Do not redefine those here.
--
-- FORCE matters: the owner role bypasses RLS by default, so ENABLE alone
-- would leave these decorative.

ALTER TABLE "courses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "courses" FORCE ROW LEVEL SECURITY;
CREATE POLICY "courses_tenant_isolation" ON "courses"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

ALTER TABLE "modules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "modules" FORCE ROW LEVEL SECURITY;
CREATE POLICY "modules_tenant_isolation" ON "modules"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

ALTER TABLE "chapters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chapters" FORCE ROW LEVEL SECURITY;
CREATE POLICY "chapters_tenant_isolation" ON "chapters"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

ALTER TABLE "lessons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lessons" FORCE ROW LEVEL SECURITY;
CREATE POLICY "lessons_tenant_isolation" ON "lessons"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

ALTER TABLE "lesson_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lesson_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "lesson_items_tenant_isolation" ON "lesson_items"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

ALTER TABLE "video_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "video_assets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "video_assets_tenant_isolation" ON "video_assets"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

ALTER TABLE "course_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "course_assignments_tenant_isolation" ON "course_assignments"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

-- ── Invariant 1: school_id must match the parent's ─────────────────────────
--
-- school_id is denormalised onto every level so the policies above can stay
-- flat (see schema.prisma). That denormalisation is only safe if it cannot
-- drift: a lesson carrying school A's id while hanging off school B's chapter
-- is a row RLS would then faithfully serve to the WRONG tenant. The isolation
-- mechanism becomes the leak. So it is checked by the database, not left to
-- application discipline.
--
-- Deliberately NOT security definer. The lookup runs under the caller's RLS,
-- so a parent in another school is simply invisible and the insert fails as
-- "no visible parent" rather than "school mismatch". Both are refusals; the
-- difference does not matter, and a definer function here would open a
-- cross-tenant read surface to buy nothing.
CREATE OR REPLACE FUNCTION app_assert_parent_school() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
DECLARE
  parent_table  text := TG_ARGV[0];
  fk_column     text := TG_ARGV[1];
  row_school    uuid;
  parent_id     uuid;
  parent_school uuid;
BEGIN
  row_school := (to_jsonb(NEW) ->> 'school_id')::uuid;
  parent_id  := (to_jsonb(NEW) ->> fk_column)::uuid;

  EXECUTE format('SELECT school_id FROM %I WHERE id = $1', parent_table)
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

CREATE TRIGGER "modules_school_parity"
  BEFORE INSERT OR UPDATE ON "modules"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('courses', 'course_id');

CREATE TRIGGER "chapters_school_parity"
  BEFORE INSERT OR UPDATE ON "chapters"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('modules', 'module_id');

CREATE TRIGGER "lessons_school_parity"
  BEFORE INSERT OR UPDATE ON "lessons"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('chapters', 'chapter_id');

CREATE TRIGGER "lesson_items_school_parity"
  BEFORE INSERT OR UPDATE ON "lesson_items"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('lessons', 'lesson_id');

CREATE TRIGGER "course_assignments_course_parity"
  BEFORE INSERT OR UPDATE ON "course_assignments"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('courses', 'course_id');

-- A course may only be taught to a class in the same school. Without this a
-- course could be attached to another tenant's class, and the enrolment join
-- that decides "who may see this course" would then answer with their roster.
CREATE TRIGGER "course_assignments_class_parity"
  BEFORE INSERT OR UPDATE ON "course_assignments"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('classes', 'class_id');

-- video_assets keys on lesson_item_id rather than id, so it uses the same
-- function with a different column name.
CREATE TRIGGER "video_assets_school_parity"
  BEFORE INSERT OR UPDATE ON "video_assets"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('lesson_items', 'lesson_item_id');

-- ── Invariant 2: kind must agree with the specialised row ──────────────────
--
-- A lesson_item with kind = 'QUIZ' carrying a video_assets row is nonsense.
-- Enforced from both sides, because the disagreement can be created either by
-- attaching the wrong specialised row or by editing the kind out from under an
-- existing one.
CREATE OR REPLACE FUNCTION app_assert_video_item_kind() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
DECLARE
  item_kind "LessonItemKind";
BEGIN
  SELECT kind INTO item_kind FROM "lesson_items" WHERE id = NEW.lesson_item_id;

  IF item_kind IS DISTINCT FROM 'VIDEO'::"LessonItemKind" THEN
    RAISE EXCEPTION
      'edusphere: video_assets requires a lesson item of kind VIDEO, got %',
      coalesce(item_kind::text, 'no visible item')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER "video_assets_kind_check"
  BEFORE INSERT OR UPDATE ON "video_assets"
  FOR EACH ROW EXECUTE FUNCTION app_assert_video_item_kind();

CREATE OR REPLACE FUNCTION app_assert_lesson_item_kind_stable() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind
     AND EXISTS (SELECT 1 FROM "video_assets" WHERE lesson_item_id = NEW.id) THEN
    RAISE EXCEPTION
      'edusphere: cannot change kind of lesson item % while a video asset is attached', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER "lesson_items_kind_stable"
  BEFORE UPDATE ON "lesson_items"
  FOR EACH ROW EXECUTE FUNCTION app_assert_lesson_item_kind_stable();

-- ── GRANTs ─────────────────────────────────────────────────────────────────
--
-- 20260802160000_app_role set ALTER DEFAULT PRIVILEGES for the owning role, so
-- tables it creates later should inherit these. Granted explicitly anyway:
-- default privileges are keyed to the role that granted them, and a table the
-- application role cannot touch fails at RUNTIME, not at migration time. This
-- is idempotent and costs nothing.
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edusphere_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON
      "courses", "modules", "chapters", "lessons", "lesson_items",
      "video_assets", "course_assignments" TO edusphere_app';
  END IF;
END
$grants$;
