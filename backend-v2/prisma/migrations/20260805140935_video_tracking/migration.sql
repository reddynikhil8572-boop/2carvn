-- CreateEnum
CREATE TYPE "VideoEventType" AS ENUM ('PLAY', 'PAUSE', 'SEEK', 'ENDED', 'HEARTBEAT');

-- CreateTable
CREATE TABLE "video_progress" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "lesson_item_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "watched_seconds" INTEGER NOT NULL DEFAULT 0,
    "last_position_seconds" INTEGER NOT NULL DEFAULT 0,
    "furthest_position_seconds" INTEGER NOT NULL DEFAULT 0,
    "percent_complete" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "replay_count" INTEGER NOT NULL DEFAULT 0,
    "last_playback_rate" DOUBLE PRECISION,
    "last_device" TEXT,
    "first_watched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_events" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "lesson_item_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "type" "VideoEventType" NOT NULL,
    "position_seconds" INTEGER NOT NULL,
    "playback_rate" DOUBLE PRECISION,
    "device" TEXT,
    "claimed_seconds" INTEGER,
    "credited_seconds" INTEGER,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "video_progress_school_id_idx" ON "video_progress"("school_id");

-- CreateIndex
CREATE INDEX "video_progress_student_id_idx" ON "video_progress"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_progress_lesson_item_id_student_id_key" ON "video_progress"("lesson_item_id", "student_id");

-- CreateIndex
CREATE INDEX "video_events_school_id_occurred_at_idx" ON "video_events"("school_id", "occurred_at");

-- CreateIndex
CREATE INDEX "video_events_lesson_item_id_student_id_idx" ON "video_events"("lesson_item_id", "student_id");

-- AddForeignKey
ALTER TABLE "video_progress" ADD CONSTRAINT "video_progress_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_progress" ADD CONSTRAINT "video_progress_lesson_item_id_fkey" FOREIGN KEY ("lesson_item_id") REFERENCES "lesson_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_progress" ADD CONSTRAINT "video_progress_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_events" ADD CONSTRAINT "video_events_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_events" ADD CONSTRAINT "video_events_lesson_item_id_fkey" FOREIGN KEY ("lesson_item_id") REFERENCES "lesson_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_events" ADD CONSTRAINT "video_events_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written from here down: RLS, parity triggers, append-only enforcement
-- and the bounds that stop a client claiming nonsense.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "video_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "video_progress" FORCE ROW LEVEL SECURITY;
CREATE POLICY "video_progress_tenant_isolation" ON "video_progress"
  USING (app_is_super_admin() OR school_id = app_current_school())
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

ALTER TABLE "video_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "video_events" FORCE ROW LEVEL SECURITY;

-- Append-only, enforced by the POLICY rather than by application discipline.
-- Two separate policies: everything may be read and inserted within the
-- tenant, and there is deliberately NO policy FOR UPDATE or FOR DELETE.
--
-- RLS denies by omission, so an UPDATE or DELETE simply matches zero rows
-- rather than raising — exactly like audit_logs. Assert affected-row counts in
-- tests, not exceptions.
CREATE POLICY "video_events_select" ON "video_events"
  FOR SELECT
  USING (app_is_super_admin() OR school_id = app_current_school());

CREATE POLICY "video_events_insert" ON "video_events"
  FOR INSERT
  WITH CHECK (app_is_super_admin() OR school_id = app_current_school());

-- ── school_id parity with the parent ───────────────────────────────────────

CREATE TRIGGER "video_progress_school_parity"
  BEFORE INSERT OR UPDATE ON "video_progress"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('lesson_items', 'lesson_item_id');

CREATE TRIGGER "video_events_school_parity"
  BEFORE INSERT ON "video_events"
  FOR EACH ROW EXECUTE FUNCTION app_assert_parent_school('lesson_items', 'lesson_item_id');

-- ── Bounds on what can be stored ───────────────────────────────────────────
--
-- The service clamps every heartbeat against the server clock, which is the
-- real defence (see video.service.ts). These checks are the backstop: they
-- catch a coding error in that arithmetic rather than a lying client, and they
-- make the invariants readable from the schema.
ALTER TABLE "video_progress"
  ADD CONSTRAINT "video_progress_non_negative"
  CHECK (
    watched_seconds >= 0
    AND last_position_seconds >= 0
    AND furthest_position_seconds >= 0
    AND replay_count >= 0
  );

ALTER TABLE "video_progress"
  ADD CONSTRAINT "video_progress_percent_range"
  CHECK (percent_complete BETWEEN 0 AND 100);

-- Rewinding moves last_position back; it must never reduce how far the student
-- has actually reached.
ALTER TABLE "video_progress"
  ADD CONSTRAINT "video_progress_furthest_is_furthest"
  CHECK (furthest_position_seconds >= last_position_seconds);

ALTER TABLE "video_events"
  ADD CONSTRAINT "video_events_non_negative"
  CHECK (
    position_seconds >= 0
    AND (claimed_seconds IS NULL OR claimed_seconds >= 0)
    AND (credited_seconds IS NULL OR credited_seconds >= 0)
  );

-- Credit can never exceed the claim. If this ever fires, the clamping logic is
-- wrong in the direction that inflates progress.
ALTER TABLE "video_events"
  ADD CONSTRAINT "video_events_credit_within_claim"
  CHECK (
    claimed_seconds IS NULL
    OR credited_seconds IS NULL
    OR credited_seconds <= claimed_seconds
  );

-- ── GRANTs ─────────────────────────────────────────────────────────────────
--
-- video_events gets SELECT and INSERT only. The policies already make UPDATE
-- and DELETE return nothing, but withholding the privilege as well means an
-- attempt errors loudly instead of silently affecting zero rows.
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edusphere_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "video_progress" TO edusphere_app';
    EXECUTE 'GRANT SELECT, INSERT ON "video_events" TO edusphere_app';
    EXECUTE 'REVOKE UPDATE, DELETE ON "video_events" FROM edusphere_app';
  END IF;
END
$grants$;
