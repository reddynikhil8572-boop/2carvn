import { withTenant } from '../db/tenantContext';
import { findEditableCourse, findEditableCourseForLessonItem } from './courseAccess';
import type { TokenPayload } from '../utils/jwt';
import type { CreateLessonItemInput, UpdateLessonItemInput } from '../validators/course.validator';

/**
 * The lesson spine — one ordered list of activities per lesson, whatever their
 * kind. See docs/PHASE2_COURSE_DESIGN.md §3.2 for why this is a spine table
 * with 1:1 specialised rows rather than three independent tables.
 *
 * This increment implements VIDEO only. QUIZ and ASSIGNMENT are valid kinds in
 * the schema and are refused here with a clear message until their tables
 * exist, so the scope boundary is an explicit 501 rather than a foreign-key
 * error or a half-created row.
 */

const notFound = (message: string) => Object.assign(new Error(message), { statusCode: 404 });
const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

const BY_POSITION = [{ position: 'asc' as const }, { createdAt: 'asc' as const }];

export const createLessonItem = async (
  user: TokenPayload,
  lessonId: string,
  input: CreateLessonItemInput
) =>
  withTenant(user.schoolId!, async (tx) => {
    const lesson = await tx.lesson.findUnique({
      where: { id: lessonId },
      select: { chapter: { select: { module: { select: { courseId: true } } } } },
    });
    if (!lesson) throw notFound('Lesson not found');

    await findEditableCourse(tx, lesson.chapter.module.courseId, user);

    const last = await tx.lessonItem.findFirst({
      where: { lessonId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const common = {
      schoolId: user.schoolId!,
      lessonId,
      title: input.title,
      position: input.position ?? (last ? last.position + 1 : 0),
      isPublished: input.isPublished ?? false,
    };

    // The specialised row is created in the same statement as the spine row,
    // so an item never exists in a state where its `kind` promises content
    // that is not there.
    if (input.kind === 'QUIZ') {
      return tx.lessonItem.create({
        data: {
          ...common,
          kind: 'QUIZ',
          quiz: {
            create: {
              schoolId: user.schoolId!,
              instructions: input.instructions,
              passingScore: input.passingScore,
              timeLimitMinutes: input.timeLimitMinutes,
              maxAttempts: input.maxAttempts,
              shuffleQuestions: input.shuffleQuestions,
            },
          },
        },
        include: { quiz: true },
      });
    }

    if (input.kind === 'ASSIGNMENT') {
      return tx.lessonItem.create({
        data: {
          ...common,
          kind: 'ASSIGNMENT',
          assignment: {
            create: {
              schoolId: user.schoolId!,
              instructions: input.instructions,
              dueAt: input.dueAt,
              maxPoints: input.maxPoints,
              allowsLate: input.allowsLate,
              allowsFile: input.allowsFile,
            },
          },
        },
        include: { assignment: true },
      });
    }

    return tx.lessonItem.create({
      data: {
        ...common,
        kind: 'VIDEO',
        video: {
          create: {
            schoolId: user.schoolId!,
            provider: input.provider,
            externalUrl: input.externalUrl,
            durationSeconds: input.durationSeconds,
          },
        },
      },
      include: { video: true },
    });
  });

/**
 * Updates an item's own fields and, for a video, its asset.
 *
 * `kind` is deliberately not updatable. Changing it would leave the
 * specialised row describing something the item no longer is; the database
 * refuses it too (lesson_items_kind_stable), so this is the API agreeing with
 * the constraint rather than duplicating it.
 */
export const updateLessonItem = async (
  user: TokenPayload,
  itemId: string,
  input: UpdateLessonItemInput
) =>
  withTenant(user.schoolId!, async (tx) => {
    await findEditableCourseForLessonItem(tx, itemId, user);

    const hasVideoFields =
      input.provider !== undefined ||
      input.externalUrl !== undefined ||
      input.durationSeconds !== undefined;

    return tx.lessonItem.update({
      where: { id: itemId },
      data: {
        title: input.title,
        position: input.position,
        isPublished: input.isPublished,
        ...(hasVideoFields && {
          video: {
            update: {
              provider: input.provider,
              externalUrl: input.externalUrl,
              durationSeconds: input.durationSeconds,
            },
          },
        }),
      },
      include: { video: true },
    });
  });

/**
 * Reorders every item in a lesson in one transaction.
 *
 * The caller sends the complete list of item ids in the order they should
 * appear, and positions are rewritten as 0..n-1. Requiring the whole list —
 * rather than accepting a partial one — is what makes the result deterministic:
 * a partial reorder has to interleave with positions it was not told about, and
 * two clients doing that concurrently produce an order neither asked for.
 *
 * Because `position` carries no unique constraint (schema.prisma), this is a
 * plain sequence of updates with no need to shuffle around the constraint.
 */
export const reorderLessonItems = async (
  user: TokenPayload,
  lessonId: string,
  orderedIds: string[]
) =>
  withTenant(user.schoolId!, async (tx) => {
    const lesson = await tx.lesson.findUnique({
      where: { id: lessonId },
      select: { chapter: { select: { module: { select: { courseId: true } } } } },
    });
    if (!lesson) throw notFound('Lesson not found');

    await findEditableCourse(tx, lesson.chapter.module.courseId, user);

    const existing = await tx.lessonItem.findMany({
      where: { lessonId },
      select: { id: true },
    });

    // Reject a list that does not exactly match the lesson's items. Silently
    // ignoring an unknown id would let a caller believe a reorder applied when
    // part of it did not, and omitting one would leave it at a stale position
    // colliding with a new one.
    const existingIds = new Set(existing.map((item) => item.id));
    const submitted = new Set(orderedIds);

    if (submitted.size !== orderedIds.length) {
      throw badRequest('Duplicate ids in reorder request');
    }
    if (submitted.size !== existingIds.size || orderedIds.some((id) => !existingIds.has(id))) {
      throw badRequest('Reorder must list every item in the lesson exactly once');
    }

    await Promise.all(
      orderedIds.map((id, index) =>
        tx.lessonItem.update({ where: { id }, data: { position: index } })
      )
    );

    return tx.lessonItem.findMany({
      where: { lessonId },
      orderBy: BY_POSITION,
      include: { video: true },
    });
  });
