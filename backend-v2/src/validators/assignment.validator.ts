import { z } from 'zod';

/** Requirements §12 — assignments. */

export const updateAssignmentSchema = z
  .object({
    instructions: z.string().trim().max(10_000).optional(),
    /// Nullable so a deadline can be removed, not only changed.
    dueAt: z.coerce.date().nullable().optional(),
    maxPoints: z.number().int().min(1).max(1_000).optional(),
    allowsLate: z.boolean().optional(),
    allowsFile: z.boolean().optional(),
  })
  .strict();

/**
 * Note what is absent: any notion of when the work was submitted.
 *
 * Lateness is decided by the server against the stored `due_at`, for the same
 * reason the quiz timer is — a client that can state its own submission time
 * is never late.
 */
export const submitAssignmentSchema = z
  .object({
    bodyText: z.string().trim().min(1, 'A submission needs some text').max(50_000).optional(),
    /// Accepted by the schema so the refusal carries a useful message from the
    /// service rather than a generic "unrecognised key". Object storage is not
    /// wired up yet.
    fileKey: z.string().trim().max(500).optional(),
  })
  .strict();

export const gradeSubmissionSchema = z
  .object({
    points: z.number().int().min(0).max(1_000).optional(),
    feedback: z.string().trim().max(10_000).optional(),
    status: z.enum(['GRADED', 'RETURNED']).optional(),
  })
  .strict();

export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;
export type SubmitAssignmentInput = z.infer<typeof submitAssignmentSchema>;
export type GradeSubmissionInput = z.infer<typeof gradeSubmissionSchema>;
