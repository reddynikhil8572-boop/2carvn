import type { TenantClient } from '../db/tenantContext';
import type { TokenPayload } from '../utils/jwt';

/**
 * Authorization *inside* a school.
 *
 * Row-Level Security separates one school from another and fails closed. It
 * does NOT decide which teacher may edit which course, or which student may
 * see it — every row here already belongs to the caller's tenant. That is
 * ordinary application authorization, with the same "one forgotten clause
 * fails open" hazard as any hand-scoped query, one level down.
 *
 * Everything in this module exists so those rules live in exactly one place
 * and every handler reaches for the same helper rather than composing its own
 * `where`. See docs/PHASE2_COURSE_DESIGN.md §6.1.
 */

const forbidden = (message: string) => Object.assign(new Error(message), { statusCode: 403 });
const notFound = (message: string) => Object.assign(new Error(message), { statusCode: 404 });

/** Roles permitted to author content at all. */
export const isStaff = (role: TokenPayload['role']): boolean =>
  role === 'SCHOOL_ADMIN' || role === 'TEACHER';

/**
 * The `where` fragment that decides which courses a caller may READ.
 *
 * - Students see only PUBLISHED courses attached to a class they are enrolled
 *   in. Publishing alone is not enough: a course published for year 9 must not
 *   appear for year 7.
 * - Staff see everything in their school, drafts included, because they build
 *   it.
 *
 * Returned as a fragment rather than applied here so list and detail reads
 * cannot drift apart.
 */
export const courseReadFilter = (user: TokenPayload): Record<string, unknown> => {
  if (isStaff(user.role)) return {};

  return {
    status: 'PUBLISHED',
    assignments: {
      some: { class: { enrollments: { some: { studentId: user.userId } } } },
    },
  };
};

/**
 * Loads a course the caller may read, or throws 404.
 *
 * Deliberately 404 and not 403: a student who guesses a course id should not
 * be able to tell "this exists but is not for you" from "this does not
 * exist". Staff editing their own school get the same treatment, which costs
 * nothing.
 */
export const findReadableCourse = async (
  tx: TenantClient,
  courseId: string,
  user: TokenPayload
) => {
  const course = await tx.course.findFirst({
    where: { id: courseId, ...courseReadFilter(user) },
  });

  if (!course) throw notFound('Course not found');
  return course;
};

/**
 * Loads a course the caller may MODIFY, or throws.
 *
 * A school admin may edit any course in their school. A teacher may edit one
 * they created, or one assigned to a class they teach — the second case is
 * what lets a course be handed over without an admin re-pointing every row.
 */
export const findEditableCourse = async (
  tx: TenantClient,
  courseId: string,
  user: TokenPayload
) => {
  if (!isStaff(user.role)) throw forbidden('Only teachers and school admins may edit courses');

  const course = await tx.course.findFirst({ where: { id: courseId } });
  if (!course) throw notFound('Course not found');

  if (user.role === 'SCHOOL_ADMIN') return course;

  if (course.createdBy === user.userId) return course;

  const teaches = await tx.courseAssignment.findFirst({
    where: { courseId, class: { teacherId: user.userId } },
    select: { id: true },
  });
  if (teaches) return course;

  throw forbidden('You may only edit courses you created or teach');
};

/**
 * Walks a lesson item back up to its course and applies the edit rules there.
 *
 * Authorization is anchored on the Course at every depth rather than being
 * re-derived per level. A teacher's rights do not change between a module and
 * a lesson item, and expressing that once removes any chance of the levels
 * disagreeing.
 */
export const findEditableCourseForLessonItem = async (
  tx: TenantClient,
  lessonItemId: string,
  user: TokenPayload
) => {
  const item = await tx.lessonItem.findUnique({
    where: { id: lessonItemId },
    select: { lesson: { select: { chapter: { select: { module: { select: { courseId: true } } } } } } },
  });

  if (!item) throw notFound('Lesson item not found');
  return findEditableCourse(tx, item.lesson.chapter.module.courseId, user);
};

/**
 * The read-side counterpart of findEditableCourseForLessonItem: resolves an
 * item up to its course and applies the *read* rules there.
 *
 * Checking only `is_published` on the item is not enough. Publishing is about
 * release within a course; it says nothing about whether the caller was ever
 * meant to see that course. Without this, a student could read any published
 * item in their school by id, including from a course assigned only to another
 * class.
 */
export const findReadableCourseForLessonItem = async (
  tx: TenantClient,
  lessonItemId: string,
  user: TokenPayload
) => {
  const item = await tx.lessonItem.findFirst({
    where: { id: lessonItemId, ...lessonItemReadFilter(user) },
    select: {
      lesson: { select: { chapter: { select: { module: { select: { courseId: true } } } } } },
    },
  });

  if (!item) throw notFound('Not found');
  return findReadableCourse(tx, item.lesson.chapter.module.courseId, user);
};

/**
 * Students see only released items; staff see everything so they can preview
 * what they are building.
 */
export const lessonItemReadFilter = (user: TokenPayload): Record<string, unknown> =>
  isStaff(user.role) ? {} : { isPublished: true };
