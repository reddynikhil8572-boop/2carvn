CREATE TYPE "AllocationRequestType" AS ENUM ('ASSIGN', 'REPLACE', 'REASSIGN');
CREATE TYPE "AllocationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "teacher_allocations" (
  "id" UUID NOT NULL,
  "school_id" UUID NOT NULL,
  "teacher_id" UUID NOT NULL,
  "class_id" UUID NOT NULL,
  "subject" TEXT NOT NULL,
  "section" TEXT NOT NULL,
  "weekly_hours" DOUBLE PRECISION NOT NULL,
  "starts_at" DATE,
  "ends_at" DATE,
  "substitute_for_id" UUID,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "teacher_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teacher_allocations_weekly_hours_check" CHECK ("weekly_hours" >= 0 AND "weekly_hours" <= 60),
  CONSTRAINT "teacher_allocations_subject_check" CHECK (length(btrim("subject")) > 0),
  CONSTRAINT "teacher_allocations_section_check" CHECK (length(btrim("section")) > 0),
  CONSTRAINT "teacher_allocations_dates_check" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" >= "starts_at"),
  CONSTRAINT "teacher_allocations_substitute_dates_check" CHECK ("substitute_for_id" IS NULL OR ("starts_at" IS NOT NULL AND "ends_at" IS NOT NULL))
);

CREATE TABLE "teacher_availabilities" (
  "id" UUID NOT NULL,
  "school_id" UUID NOT NULL,
  "teacher_id" UUID NOT NULL,
  "weekday" INTEGER NOT NULL,
  "start_minute" INTEGER NOT NULL,
  "end_minute" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "teacher_availabilities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teacher_availabilities_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6),
  CONSTRAINT "teacher_availabilities_time_check" CHECK ("start_minute" >= 0 AND "end_minute" <= 1440 AND "start_minute" < "end_minute")
);

CREATE TABLE "teacher_timetable_slots" (
  "id" UUID NOT NULL,
  "school_id" UUID NOT NULL,
  "allocation_id" UUID NOT NULL,
  "weekday" INTEGER NOT NULL,
  "start_minute" INTEGER NOT NULL,
  "end_minute" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "teacher_timetable_slots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teacher_timetable_slots_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6),
  CONSTRAINT "teacher_timetable_slots_time_check" CHECK ("start_minute" >= 0 AND "end_minute" <= 1440 AND "start_minute" < "end_minute")
);

CREATE TABLE "teacher_allocation_requests" (
  "id" UUID NOT NULL,
  "school_id" UUID NOT NULL,
  "requester_id" UUID NOT NULL,
  "reviewer_id" UUID,
  "type" "AllocationRequestType" NOT NULL,
  "status" "AllocationRequestStatus" NOT NULL DEFAULT 'PENDING',
  "teacher_id" UUID NOT NULL,
  "class_id" UUID NOT NULL,
  "subject" TEXT NOT NULL,
  "section" TEXT NOT NULL,
  "weekly_hours" DOUBLE PRECISION NOT NULL,
  "starts_at" DATE,
  "ends_at" DATE,
  "note" TEXT,
  "decision_note" TEXT,
  "allocation_id" UUID,
  "target_allocation_id" UUID,
  "decided_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "teacher_allocation_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teacher_allocation_requests_weekly_hours_check" CHECK ("weekly_hours" > 0 AND "weekly_hours" <= 60),
  CONSTRAINT "teacher_allocation_requests_subject_check" CHECK (length(btrim("subject")) > 0),
  CONSTRAINT "teacher_allocation_requests_section_check" CHECK (length(btrim("section")) > 0),
  CONSTRAINT "teacher_allocation_requests_dates_check" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" >= "starts_at"),
  CONSTRAINT "teacher_allocation_requests_decision_check" CHECK (
    ("status" = 'PENDING' AND "reviewer_id" IS NULL AND "decided_at" IS NULL)
    OR ("status" <> 'PENDING' AND "decided_at" IS NOT NULL)
  )
);

CREATE INDEX "teacher_allocations_school_id_teacher_id_is_active_idx" ON "teacher_allocations"("school_id", "teacher_id", "is_active");
CREATE INDEX "teacher_allocations_school_id_class_id_subject_section_idx" ON "teacher_allocations"("school_id", "class_id", "subject", "section");
CREATE INDEX "teacher_allocations_substitute_for_id_idx" ON "teacher_allocations"("substitute_for_id");
CREATE INDEX "teacher_availabilities_school_id_teacher_id_weekday_idx" ON "teacher_availabilities"("school_id", "teacher_id", "weekday");
CREATE INDEX "teacher_timetable_slots_school_id_weekday_start_minute_idx" ON "teacher_timetable_slots"("school_id", "weekday", "start_minute");
CREATE INDEX "teacher_timetable_slots_allocation_id_idx" ON "teacher_timetable_slots"("allocation_id");
CREATE INDEX "teacher_allocation_requests_school_id_status_created_at_idx" ON "teacher_allocation_requests"("school_id", "status", "created_at");
CREATE INDEX "teacher_allocation_requests_requester_id_idx" ON "teacher_allocation_requests"("requester_id");

ALTER TABLE "teacher_allocations"
  ADD CONSTRAINT "teacher_allocations_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "teacher_allocations_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "teacher_allocations_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "teacher_allocations_substitute_for_id_fkey" FOREIGN KEY ("substitute_for_id") REFERENCES "teacher_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "teacher_availabilities"
  ADD CONSTRAINT "teacher_availabilities_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "teacher_availabilities_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "teacher_timetable_slots"
  ADD CONSTRAINT "teacher_timetable_slots_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "teacher_timetable_slots_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "teacher_allocations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "teacher_allocation_requests"
  ADD CONSTRAINT "teacher_allocation_requests_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "teacher_allocation_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "teacher_allocation_requests_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "teacher_allocation_requests_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "teacher_allocation_requests_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "teacher_allocation_requests_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "teacher_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "teacher_allocation_requests_target_allocation_id_fkey" FOREIGN KEY ("target_allocation_id") REFERENCES "teacher_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'teacher_allocations',
    'teacher_availabilities',
    'teacher_timetable_slots',
    'teacher_allocation_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (app_is_super_admin() OR school_id = app_current_school()) WITH CHECK (app_is_super_admin() OR school_id = app_current_school())',
      table_name || '_tenant_isolation',
      table_name
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION app_assert_teacher_allocation_scope() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  teacher_school UUID;
  teacher_role "UserRole";
  class_school UUID;
  parent_school UUID;
BEGIN
  SELECT school_id, role INTO teacher_school, teacher_role FROM "users" WHERE id = NEW.teacher_id;
  SELECT school_id INTO class_school FROM "classes" WHERE id = NEW.class_id;

  IF teacher_school IS DISTINCT FROM NEW.school_id OR teacher_role IS DISTINCT FROM 'TEACHER'::"UserRole" THEN
    RAISE EXCEPTION 'teacher allocation requires a teacher in the same school'
      USING ERRCODE = 'check_violation';
  END IF;
  IF class_school IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'teacher allocation class must belong to the same school'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.substitute_for_id IS NOT NULL THEN
    SELECT school_id INTO parent_school FROM "teacher_allocations" WHERE id = NEW.substitute_for_id;
    IF parent_school IS DISTINCT FROM NEW.school_id THEN
      RAISE EXCEPTION 'substitution target must belong to the same school'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "teacher_allocations_scope_check"
  BEFORE INSERT OR UPDATE ON "teacher_allocations"
  FOR EACH ROW EXECUTE FUNCTION app_assert_teacher_allocation_scope();

CREATE OR REPLACE FUNCTION app_assert_teacher_availability_scope() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  teacher_school UUID;
  teacher_role "UserRole";
BEGIN
  SELECT school_id, role INTO teacher_school, teacher_role FROM "users" WHERE id = NEW.teacher_id;
  IF teacher_school IS DISTINCT FROM NEW.school_id OR teacher_role IS DISTINCT FROM 'TEACHER'::"UserRole" THEN
    RAISE EXCEPTION 'availability requires a teacher in the same school'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "teacher_availabilities_scope_check"
  BEFORE INSERT OR UPDATE ON "teacher_availabilities"
  FOR EACH ROW EXECUTE FUNCTION app_assert_teacher_availability_scope();

CREATE OR REPLACE FUNCTION app_assert_teacher_allocation_request_scope() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  teacher_school UUID;
  teacher_role "UserRole";
  class_school UUID;
  requester_school UUID;
  requester_role "UserRole";
  target_school UUID;
BEGIN
  SELECT school_id, role INTO teacher_school, teacher_role FROM "users" WHERE id = NEW.teacher_id;
  SELECT school_id INTO class_school FROM "classes" WHERE id = NEW.class_id;
  SELECT school_id, role INTO requester_school, requester_role FROM "users" WHERE id = NEW.requester_id;
  IF teacher_school IS DISTINCT FROM NEW.school_id OR teacher_role IS DISTINCT FROM 'TEACHER'::"UserRole"
     OR class_school IS DISTINCT FROM NEW.school_id
     OR requester_school IS DISTINCT FROM NEW.school_id OR requester_role IS DISTINCT FROM 'SCHOOL_ADMIN'::"UserRole" THEN
    RAISE EXCEPTION 'allocation request must reference same-school teacher, class, and school administrator'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reviewer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "users" WHERE id = NEW.reviewer_id AND role = 'SUPER_ADMIN' AND school_id IS NULL
  ) THEN
    RAISE EXCEPTION 'allocation request reviewer must be a platform administrator'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.target_allocation_id IS NOT NULL THEN
    SELECT school_id INTO target_school FROM "teacher_allocations" WHERE id = NEW.target_allocation_id;
    IF target_school IS DISTINCT FROM NEW.school_id THEN
      RAISE EXCEPTION 'allocation request target must belong to the same school'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "teacher_allocation_requests_scope_check"
  BEFORE INSERT OR UPDATE ON "teacher_allocation_requests"
  FOR EACH ROW EXECUTE FUNCTION app_assert_teacher_allocation_request_scope();

CREATE TRIGGER "teacher_timetable_slots_school_parity"
  BEFORE INSERT OR UPDATE ON "teacher_timetable_slots"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('teacher_allocations', 'allocation_id');

-- Preserve existing homeroom teacher assignments in the new allocation model.
-- Their subject and workload were never captured, so they remain explicitly
-- unspecified rather than inventing a subject or weekly hours.
INSERT INTO "teacher_allocations" (
  "id", "school_id", "teacher_id", "class_id", "subject", "section", "weekly_hours", "is_active", "updated_at"
)
SELECT gen_random_uuid(), "school_id", "teacher_id", "id", 'Unspecified', 'Main', 0, true, CURRENT_TIMESTAMP
FROM "classes"
WHERE "teacher_id" IS NOT NULL;

INSERT INTO "audit_logs" ("id", "school_id", "actor_id", "action", "entity", "entity_id", "metadata", "created_at")
SELECT
  gen_random_uuid(),
  allocation."school_id",
  NULL,
  'TEACHER_ALLOCATION_IMPORTED',
  'TeacherAllocation',
  allocation."id"::text,
  jsonb_build_object(
    'legacyClassId', allocation."class_id",
    'teacherId', allocation."teacher_id",
    'source', 'classes.teacher_id'
  ),
  CURRENT_TIMESTAMP
FROM "teacher_allocations" allocation
JOIN "classes" klass
  ON klass."id" = allocation."class_id"
 AND klass."teacher_id" = allocation."teacher_id"
WHERE allocation."subject" = 'Unspecified'
  AND allocation."weekly_hours" = 0;
