import { z } from 'zod';

/** Requirements §6 — course hierarchy input validation. */

const title = z.string().trim().min(1, 'Title is required').max(200);
const position = z.number().int().min(0).max(10_000).optional();
const uuid = z.string().uuid('Invalid id');

export const idParamSchema = z.object({ id: uuid });

export const createCourseSchema = z
  .object({
    title,
    /// Optional override; otherwise derived from the title and de-duplicated
    /// within the school.
    slug: z.string().trim().max(64).optional(),
    description: z.string().trim().max(5_000).optional(),
    subject: z.string().trim().max(100).optional(),
  })
  .strict();

export const updateCourseSchema = z
  .object({
    title: title.optional(),
    description: z.string().trim().max(5_000).optional(),
    subject: z.string().trim().max(100).optional(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  })
  .strict();

export const createModuleSchema = z.object({ title, position }).strict();
export const createChapterSchema = z.object({ title, position }).strict();
export const createLessonSchema = z
  .object({ title, summary: z.string().trim().max(2_000).optional(), position })
  .strict();

/**
 * Lesson items are discriminated on `kind`, so a video body cannot carry quiz
 * fields and vice versa.
 *
 * QUIZ and ASSIGNMENT are accepted by the schema and rejected by the service
 * with a 501 — deliberately, so the boundary of this increment reads as "not
 * built yet" rather than "unknown kind". Their bodies are minimal here and
 * grow when those tables land.
 */
const videoItemSchema = z.object({
  kind: z.literal('VIDEO'),
  title,
  position,
  isPublished: z.boolean().optional(),
  provider: z.enum(['UPLOAD', 'YOUTUBE', 'VIMEO']).default('YOUTUBE'),
  /// Object storage is not wired up in this increment, so a usable video today
  /// means an external URL. See docs/PHASE2_COURSE_DESIGN.md §7.
  externalUrl: z.string().url('Must be a valid URL').max(2_000).optional(),
  durationSeconds: z.number().int().min(0).max(86_400).optional(),
});

const quizItemSchema = z.object({
  kind: z.literal('QUIZ'),
  title,
  position,
  isPublished: z.boolean().optional(),
  instructions: z.string().trim().max(5_000).optional(),
  /// Percentage of available points needed to pass.
  passingScore: z.number().int().min(0).max(100).optional(),
  timeLimitMinutes: z.number().int().min(1).max(600).optional(),
  maxAttempts: z.number().int().min(1).max(20).optional(),
  shuffleQuestions: z.boolean().optional(),
});

const assignmentItemSchema = z.object({
  kind: z.literal('ASSIGNMENT'),
  title,
  position,
  isPublished: z.boolean().optional(),
  instructions: z.string().trim().max(10_000).optional(),
  dueAt: z.coerce.date().optional(),
  maxPoints: z.number().int().min(1).max(1_000).optional(),
  allowsLate: z.boolean().optional(),
  /// Reachable only once object storage lands; submissions with a file are
  /// refused meanwhile.
  allowsFile: z.boolean().optional(),
});

export const createLessonItemSchema = z.discriminatedUnion('kind', [
  videoItemSchema,
  quizItemSchema,
  assignmentItemSchema,
]);

/** `kind` is absent by design: an item cannot change what it is. */
export const updateLessonItemSchema = z
  .object({
    title: title.optional(),
    position,
    isPublished: z.boolean().optional(),
    provider: z.enum(['UPLOAD', 'YOUTUBE', 'VIMEO']).optional(),
    externalUrl: z.string().url('Must be a valid URL').max(2_000).optional(),
    durationSeconds: z.number().int().min(0).max(86_400).optional(),
  })
  .strict();

export const reorderSchema = z
  .object({ itemIds: z.array(uuid).min(1, 'At least one item id is required').max(500) })
  .strict();

export const assignClassSchema = z.object({ classId: uuid }).strict();

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
export type CreateModuleInput = z.infer<typeof createModuleSchema>;
export type CreateChapterInput = z.infer<typeof createChapterSchema>;
export type CreateLessonInput = z.infer<typeof createLessonSchema>;
export type CreateLessonItemInput = z.infer<typeof createLessonItemSchema>;
export type UpdateLessonItemInput = z.infer<typeof updateLessonItemSchema>;
