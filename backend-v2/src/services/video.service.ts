import { withTenant } from '../db/tenantContext';
import { findReadableCourseForLessonItem, isStaff } from './courseAccess';
import type { TokenPayload } from '../utils/jwt';
import type { HeartbeatInput } from '../validators/video.validator';

/**
 * Requirements §7 — video tracking.
 *
 * ## Why this one is different
 *
 * Every other "the client is reporting on itself" problem in this codebase was
 * fixed by moving the fact to the server and deleting the field from the
 * request: the quiz start time, the attempt count, the assignment submission
 * time. See docs/PHASE2_COURSE_DESIGN.md §14.
 *
 * **That is not available here.** Only the browser knows where the playhead is,
 * and watch time is precisely what a student has an interest in inflating. The
 * report cannot be eliminated, so it is *bounded* instead: a heartbeat can
 * never credit more watch time than has genuinely elapsed on the server's clock
 * since that student's previous heartbeat on the same video.
 *
 * A client claiming 600 seconds of viewing 15 seconds after its last report
 * gets credited 15 (times the maximum plausible playback rate). It cannot
 * fast-forward its way to a completion, and it cannot replay one heartbeat a
 * thousand times, because the elapsed-time budget is consumed either way.
 *
 * This is weaker than the guarantees elsewhere and it is deliberately not
 * described as tamper-proof. It makes the cheapest attacks useless; a
 * determined client running a real player at 16× in a hidden tab still
 * accumulates time. The honest summary: watch time is *evidence*, not proof.
 */

const notFound = (m: string) => Object.assign(new Error(m), { statusCode: 404 });
const forbidden = (m: string) => Object.assign(new Error(m), { statusCode: 403 });

/**
 * The most generous playback rate we will credit. Browsers offer up to 2×, so
 * a heartbeat covering slightly more wall-clock than elapsed is legitimate
 * (a tab that was throttled, then caught up); 3× leaves headroom for clock
 * skew and scheduling delay without crediting an implausible claim.
 */
const MAX_CREDITED_RATE = 3;

/** Grace for clock skew and network latency, in seconds. */
const CLOCK_GRACE_SECONDS = 2;

/** Percentage of the video's duration that counts as finished. */
const COMPLETION_PERCENT = 90;

/** A backwards jump larger than this counts as a replay, per §7. */
const REPLAY_SEEK_THRESHOLD_SECONDS = 30;

/**
 * Records a heartbeat and returns the updated progress.
 *
 * The client sends where it is and how much it believes it watched since last
 * time. Both are recorded raw on the event, and the *credited* figure is
 * recorded beside them — so a progress row that looks wrong months later can
 * be explained rather than guessed at.
 */
export const recordHeartbeat = async (
  user: TokenPayload,
  itemId: string,
  input: HeartbeatInput
) =>
  withTenant(user.schoolId!, async (tx) => {
    // Resolves up to the course and applies the read rules, so a student
    // cannot log progress against a video from a course they were never given.
    await findReadableCourseForLessonItem(tx, itemId, user);

    if (isStaff(user.role)) {
      throw forbidden('Staff progress is not tracked');
    }

    const item = await tx.lessonItem.findFirst({
      where: { id: itemId, kind: 'VIDEO' },
      include: { video: { select: { durationSeconds: true } } },
    });
    if (!item) throw notFound('Video not found');

    const existing = await tx.videoProgress.findUnique({
      where: { lessonItemId_studentId: { lessonItemId: itemId, studentId: user.userId } },
    });

    const now = new Date();
    const claimed = input.watchedSecondsDelta ?? 0;

    // ── The clamp ──────────────────────────────────────────────────────────
    // Elapsed server time since this student's previous heartbeat on this
    // video is the budget. A first heartbeat gets one interval's worth rather
    // than unlimited credit, or the opening report could claim the whole video.
    const elapsedSeconds = existing
      ? Math.max(0, (now.getTime() - existing.updatedAt.getTime()) / 1000)
      : input.intervalSeconds;

    const budget = Math.floor((elapsedSeconds + CLOCK_GRACE_SECONDS) * MAX_CREDITED_RATE);
    const credited = Math.max(0, Math.min(claimed, budget));

    const previousPosition = existing?.lastPositionSeconds ?? 0;
    const furthest = Math.max(existing?.furthestPositionSeconds ?? 0, input.positionSeconds);

    // §7 asks for replays. A large backwards jump is the only signal a player
    // gives us for "watched that bit again".
    const wentBack = previousPosition - input.positionSeconds > REPLAY_SEEK_THRESHOLD_SECONDS;

    const watchedSeconds = (existing?.watchedSeconds ?? 0) + credited;

    // Percent is derived from the furthest point reached, but completion also
    // requires enough CREDITED watch time — otherwise dragging the scrubber to
    // the end would mark the video finished without watching any of it.
    const duration = item.video?.durationSeconds ?? null;
    const percent = duration && duration > 0 ? Math.min(100, Math.round((furthest / duration) * 100)) : 0;

    const enoughWatched = duration ? watchedSeconds >= (duration * COMPLETION_PERCENT) / 100 : false;
    const completedAt =
      existing?.completedAt ?? (percent >= COMPLETION_PERCENT && enoughWatched ? now : null);

    const progress = await tx.videoProgress.upsert({
      where: { lessonItemId_studentId: { lessonItemId: itemId, studentId: user.userId } },
      create: {
        schoolId: user.schoolId!,
        lessonItemId: itemId,
        studentId: user.userId,
        watchedSeconds: credited,
        lastPositionSeconds: input.positionSeconds,
        furthestPositionSeconds: furthest,
        percentComplete: percent,
        completedAt,
        replayCount: 0,
        lastPlaybackRate: input.playbackRate,
        lastDevice: input.device,
      },
      update: {
        watchedSeconds,
        lastPositionSeconds: input.positionSeconds,
        furthestPositionSeconds: furthest,
        percentComplete: percent,
        completedAt,
        ...(wentBack ? { replayCount: { increment: 1 } } : {}),
        lastPlaybackRate: input.playbackRate,
        lastDevice: input.device,
      },
    });

    await tx.videoEvent.create({
      data: {
        schoolId: user.schoolId!,
        lessonItemId: itemId,
        studentId: user.userId,
        type: input.type,
        positionSeconds: input.positionSeconds,
        playbackRate: input.playbackRate,
        device: input.device,
        // Both figures, side by side. The gap between them is the audit trail.
        claimedSeconds: claimed,
        creditedSeconds: credited,
      },
    });

    return progress;
  });

/** A student's own progress on one video. */
export const getOwnProgress = async (user: TokenPayload, itemId: string) =>
  withTenant(user.schoolId!, async (tx) => {
    await findReadableCourseForLessonItem(tx, itemId, user);

    return tx.videoProgress.findUnique({
      where: { lessonItemId_studentId: { lessonItemId: itemId, studentId: user.userId } },
    });
  });

/**
 * Everyone's progress on one video — staff only.
 *
 * Same reasoning as grades: RLS puts us in the right school but says nothing
 * about which pupil's numbers the caller may see, so the check is here.
 */
export const listProgressForItem = async (user: TokenPayload, itemId: string) =>
  withTenant(user.schoolId!, async (tx) => {
    if (!isStaff(user.role)) throw forbidden('Only staff may see the class list');

    await findReadableCourseForLessonItem(tx, itemId, user);

    return tx.videoProgress.findMany({
      where: { lessonItemId: itemId },
      include: { student: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  });

/**
 * §8 — a course-level roll-up for staff: per video, how many students have
 * started and finished, and the median-ish average completion.
 *
 * Deliberately computed from `video_progress` rather than by replaying
 * `video_events`. The event log exists to answer questions nobody has thought
 * of yet and to audit a suspicious row; using it for the everyday dashboard
 * would make the common read scale with the number of heartbeats ever sent.
 */
export const courseVideoAnalytics = async (user: TokenPayload, courseId: string) =>
  withTenant(user.schoolId!, async (tx) => {
    if (!isStaff(user.role)) throw forbidden('Only staff may see course analytics');

    const course = await tx.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!course) throw notFound('Course not found');

    const items = await tx.lessonItem.findMany({
      where: {
        kind: 'VIDEO',
        lesson: { chapter: { module: { courseId } } },
      },
      select: {
        id: true,
        title: true,
        video: { select: { durationSeconds: true } },
        videoProgress: {
          select: { watchedSeconds: true, percentComplete: true, completedAt: true },
        },
      },
      orderBy: { position: 'asc' },
    });

    // How many students the course actually reaches, so "3 of 30 finished"
    // is expressible rather than just "3 finished".
    const audience = await tx.enrollment.count({
      where: { class: { courseAssignments: { some: { courseId } } } },
    });

    return {
      audience,
      videos: items.map((item) => {
        const rows = item.videoProgress;
        const started = rows.length;
        const completed = rows.filter((r) => r.completedAt !== null).length;
        const averagePercent =
          started === 0
            ? 0
            : Math.round(rows.reduce((sum, r) => sum + r.percentComplete, 0) / started);

        return {
          lessonItemId: item.id,
          title: item.title,
          durationSeconds: item.video?.durationSeconds ?? null,
          audience,
          started,
          completed,
          averagePercent,
          totalWatchedSeconds: rows.reduce((sum, r) => sum + r.watchedSeconds, 0),
        };
      }),
    };
  });

export const VIDEO_TUNING = {
  MAX_CREDITED_RATE,
  CLOCK_GRACE_SECONDS,
  COMPLETION_PERCENT,
  REPLAY_SEEK_THRESHOLD_SECONDS,
};
