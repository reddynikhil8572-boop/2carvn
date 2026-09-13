import type { TenantClient } from '../db/tenantContext';
import { withTenant } from '../db/tenantContext';
import {
  courseReadFilter,
  findEditableCourse,
  findReadableCourse,
  lessonItemReadFilter,
} from './courseAccess';
import { quizSelectFor } from './quizProjection';
import type { TokenPayload } from '../utils/jwt';
import type {
  CreateChapterInput,
  CreateCourseInput,
  CreateLessonInput,
  CreateModuleInput,
  UpdateCourseInput,
} from '../validators/course.validator';

/**
 * Requirements §6 — the container half of the course hierarchy:
 * Course → Module → Chapter → Lesson.
 *
 * Every function here runs inside withTenant(), so Row-Level Security is in
 * force for every statement. Nothing in this file touches the raw prisma
 * client, and nothing uses asSuperAdmin(): a course belongs to exactly one
 * school and there is no cross-tenant course operation.
 */

const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });
const notFound = (message: string) => Object.assign(new Error(message), { statusCode: 404 });

/** Ordering used by every read of an ordered level. */
const BY_POSITION = [{ position: 'asc' as const }, { createdAt: 'asc' as const }];

const slugify = (title: string): string =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'course';

/**
 * Finds a free slug within the school.
 *
 * Slugs are unique per (school_id, slug), so two schools may both have
 * "algebra-1" — the collision only has to be resolved inside one tenant.
 */
const uniqueSlug = async (tx: TenantClient, base: string): Promise<string> => {
  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const taken = await tx.course.findFirst({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw conflict('Could not allocate a unique slug for this title');
};

/**
 * Creates a course, plus a default Module and Chapter.
 *
 * §6 mandates four container levels, but requiring four calls before a teacher
 * can add a single video would make the depth a tax rather than a feature.
 * A course therefore arrives usable: someone who never thinks about modules
 * sees a flat list of lessons, and someone who wants the structure renames
 * what is already there. See docs/PHASE2_COURSE_DESIGN.md §4.3.
 */
export const createCourse = async (user: TokenPayload, input: CreateCourseInput) => {
  const schoolId = user.schoolId!;

  return withTenant(schoolId, async (tx) => {
    const slug = await uniqueSlug(tx, input.slug ? slugify(input.slug) : slugify(input.title));

    const course = await tx.course.create({
      data: {
        schoolId,
        title: input.title,
        slug,
        description: input.description,
        subject: input.subject,
        createdBy: user.userId,
      },
    });

    const module = await tx.module.create({
      data: { schoolId, courseId: course.id, title: input.title, position: 0 },
    });

    await tx.chapter.create({
      data: { schoolId, moduleId: module.id, title: input.title, position: 0 },
    });

    await tx.auditLog.create({
      data: {
        schoolId,
        actorId: user.userId,
        action: 'COURSE_CREATED',
        entity: 'Course',
        entityId: course.id,
        metadata: { slug: course.slug },
      },
    });

    return course;
  });
};

/**
 * Lists courses the caller may see. Staff get their school's whole catalogue
 * including drafts; students get only published courses attached to a class
 * they are enrolled in — see courseAccess.courseReadFilter.
 */
export const listCourses = async (user: TokenPayload) =>
  withTenant(user.schoolId!, (tx) =>
    tx.course.findMany({
      where: courseReadFilter(user),
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { _count: { select: { modules: true, assignments: true } } },
    })
  );

/**
 * The full tree for one course.
 *
 * Students see only released lesson items; staff see everything so they can
 * preview what they are building. The filter is applied at the item level
 * rather than by post-processing the result, so an unpublished item never
 * reaches the process in the first place.
 */
export const getCourseTree = async (user: TokenPayload, courseId: string) =>
  withTenant(user.schoolId!, async (tx) => {
    await findReadableCourse(tx, courseId, user);

    return tx.course.findUnique({
      where: { id: courseId },
      include: {
        modules: {
          orderBy: BY_POSITION,
          include: {
            chapters: {
              orderBy: BY_POSITION,
              include: {
                lessons: {
                  orderBy: BY_POSITION,
                  include: {
                    items: {
                      where: lessonItemReadFilter(user),
                      orderBy: BY_POSITION,
                      include: {
                        video: true,
                        // Never a bare `quiz: true` — that returns every
                        // option including is_correct. The tree is the easiest
                        // place in the codebase to leak correct answers,
                        // because nothing about the call site mentions quizzes.
                        quiz: quizSelectFor(user),
                        // Likewise never a bare `assignment: true` with its
                        // submissions: that would hand every student the whole
                        // class's marks and feedback.
                        assignment: {
                          select: {
                            lessonItemId: true,
                            instructions: true,
                            dueAt: true,
                            maxPoints: true,
                            allowsLate: true,
                            allowsFile: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        assignments: { include: { class: { select: { id: true, name: true } } } },
      },
    });
  });

/**
 * Updates course metadata, including publish state.
 *
 * publishedAt is set the first time a course reaches PUBLISHED and then left
 * alone: it records when the course was first released, not when it was last
 * toggled. Archiving does not clear it.
 */
export const updateCourse = async (
  user: TokenPayload,
  courseId: string,
  input: UpdateCourseInput
) =>
  withTenant(user.schoolId!, async (tx) => {
    const existing = await findEditableCourse(tx, courseId, user);

    const publishing = input.status === 'PUBLISHED' && existing.publishedAt === null;

    const updated = await tx.course.update({
      where: { id: courseId },
      data: {
        title: input.title,
        description: input.description,
        subject: input.subject,
        status: input.status,
        ...(publishing && { publishedAt: new Date() }),
      },
    });

    if (input.status && input.status !== existing.status) {
      await tx.auditLog.create({
        data: {
          schoolId: user.schoolId!,
          actorId: user.userId,
          action: `COURSE_${input.status}`,
          entity: 'Course',
          entityId: courseId,
          metadata: { from: existing.status, to: input.status },
        },
      });
    }

    return updated;
  });

/**
 * Appends a level to the end of its parent.
 *
 * `position` defaults to one past the current maximum rather than to 0, so
 * creating three modules in a row yields the order they were created in. The
 * column carries no unique constraint (see schema.prisma), so a concurrent
 * append producing two rows at the same position is harmless — reads break
 * ties on createdAt.
 */
const nextPosition = async (
  tx: TenantClient,
  model: 'module' | 'chapter' | 'lesson',
  where: Record<string, string>
): Promise<number> => {
  // Prisma's delegates are structurally identical here but not union-typed,
  // so the narrow cast is confined to this one helper.
  const last = await (tx[model] as any).findFirst({
    where,
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  return last ? last.position + 1 : 0;
};

export const createModule = async (
  user: TokenPayload,
  courseId: string,
  input: CreateModuleInput
) =>
  withTenant(user.schoolId!, async (tx) => {
    await findEditableCourse(tx, courseId, user);

    return tx.module.create({
      data: {
        schoolId: user.schoolId!,
        courseId,
        title: input.title,
        position: input.position ?? (await nextPosition(tx, 'module', { courseId })),
      },
    });
  });

export const createChapter = async (
  user: TokenPayload,
  moduleId: string,
  input: CreateChapterInput
) =>
  withTenant(user.schoolId!, async (tx) => {
    const module = await tx.module.findUnique({
      where: { id: moduleId },
      select: { courseId: true },
    });
    if (!module) throw notFound('Module not found');

    await findEditableCourse(tx, module.courseId, user);

    return tx.chapter.create({
      data: {
        schoolId: user.schoolId!,
        moduleId,
        title: input.title,
        position: input.position ?? (await nextPosition(tx, 'chapter', { moduleId })),
      },
    });
  });

export const createLesson = async (
  user: TokenPayload,
  chapterId: string,
  input: CreateLessonInput
) =>
  withTenant(user.schoolId!, async (tx) => {
    const chapter = await tx.chapter.findUnique({
      where: { id: chapterId },
      select: { module: { select: { courseId: true } } },
    });
    if (!chapter) throw notFound('Chapter not found');

    await findEditableCourse(tx, chapter.module.courseId, user);

    return tx.lesson.create({
      data: {
        schoolId: user.schoolId!,
        chapterId,
        title: input.title,
        summary: input.summary,
        position: input.position ?? (await nextPosition(tx, 'lesson', { chapterId })),
      },
    });
  });

/**
 * Attaches a course to a class — how a course reaches students at all.
 *
 * The class is looked up under RLS first, so a class id from another school is
 * simply not found. The database backs this up: a parity trigger on
 * course_assignments refuses a course and a class that belong to different
 * schools, because that pairing would make the enrolment join answer "who may
 * see this course" with another tenant's roster.
 */
export const assignCourseToClass = async (
  user: TokenPayload,
  courseId: string,
  classId: string
) =>
  withTenant(user.schoolId!, async (tx) => {
    await findEditableCourse(tx, courseId, user);

    const klass = await tx.class.findUnique({ where: { id: classId }, select: { id: true } });
    if (!klass) throw notFound('Class not found');

    const existing = await tx.courseAssignment.findUnique({
      where: { courseId_classId: { courseId, classId } },
    });
    if (existing) return existing;

    return tx.courseAssignment.create({
      data: { schoolId: user.schoolId!, courseId, classId },
    });
  });
