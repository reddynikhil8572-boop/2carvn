import { z } from 'zod';

/** Requirements §12 — quiz authoring and attempts. */

const uuid = z.string().uuid('Invalid id');

export const updateQuizSchema = z
  .object({
    instructions: z.string().trim().max(5_000).optional(),
    passingScore: z.number().int().min(0).max(100).optional(),
    timeLimitMinutes: z.number().int().min(1).max(600).nullable().optional(),
    maxAttempts: z.number().int().min(1).max(20).optional(),
    shuffleQuestions: z.boolean().optional(),
  })
  .strict();

export const createQuestionSchema = z
  .object({
    prompt: z.string().trim().min(1, 'A prompt is required').max(2_000),
    points: z.number().int().min(1).max(100).optional(),
    options: z
      .array(
        z
          .object({
            text: z.string().trim().min(1, 'Option text is required').max(1_000),
            isCorrect: z.boolean().default(false),
          })
          .strict()
      )
      .min(2, 'A question needs at least two options')
      .max(10),
  })
  .strict()
  /// A question with no correct option can never be answered correctly and
  /// would silently drag every score down. Caught here and again in the
  /// service, which does not assume it was called through this schema.
  .refine((q) => q.options.some((o) => o.isCorrect), {
    message: 'At least one option must be marked correct',
    path: ['options'],
  });

/**
 * Note what is absent: any notion of time.
 *
 * The previous implementation accepted `startedAt` from the client, which made
 * the time limit entirely defeatable. The window is now judged against the
 * `expires_at` the server stored when the attempt began, so there is nothing
 * here for a client to lie about.
 */
export const submitAttemptSchema = z
  .object({
    answers: z
      .array(
        z.object({ questionId: uuid, selectedOptionId: uuid }).strict()
      )
      .max(500),
    /// Browser-reported signals. Stored for a teacher to look at and never
    /// used to fail a submission — the client is reporting on itself.
    integrityFlags: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type UpdateQuizInput = z.infer<typeof updateQuizSchema>;
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type SubmitAttemptInput = z.infer<typeof submitAttemptSchema>;
