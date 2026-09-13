import { z } from 'zod';

/** Requirements §2 — classes and enrolment. */

export const createClassSchema = z
  .object({
    name: z.string().trim().min(1, 'A class needs a name').max(100),
    /// Free text rather than a number: schools write these differently
    /// ("2026", "2026-27", "AY2026"), and the value is only ever displayed and
    /// used for uniqueness within a school.
    academicYear: z.string().trim().min(1, 'An academic year is required').max(20),
    teacherId: z.string().uuid('Invalid teacher id').optional(),
  })
  .strict();

export const enrolSchema = z.object({ studentId: z.string().uuid('Invalid student id') }).strict();

export type CreateClassInput = z.infer<typeof createClassSchema>;
export type EnrolInput = z.infer<typeof enrolSchema>;
