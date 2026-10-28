import { z } from 'zod';

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD format')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid calendar date');

const assignmentFields = {
  teacherId: z.string().uuid(),
  classId: z.string().uuid(),
  subject: z.string().trim().min(1).max(100),
  section: z.string().trim().min(1).max(40),
  weeklyHours: z.number().positive().max(60),
  startsAt: dateOnly.nullable().optional(),
  endsAt: dateOnly.nullable().optional(),
};

const validateDateRange = <T extends { startsAt?: string | null; endsAt?: string | null }>(
  schema: z.ZodType<T>,
) =>
  schema.superRefine((value, context) => {
    if (value.startsAt && value.endsAt && value.endsAt < value.startsAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'End date must be on or after start date',
      });
    }
  });

export const createTeacherAllocationSchema = validateDateRange(
  z.object({
    ...assignmentFields,
    substituteForId: z.string().uuid().optional(),
    replacesAllocationId: z.string().uuid().optional(),
  }).strict(),
).superRefine((value, context) => {
  if (value.substituteForId && (!value.startsAt || !value.endsAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startsAt'],
      message: 'A temporary substitution needs both start and end dates',
    });
  }
  if (value.substituteForId && value.replacesAllocationId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['replacesAllocationId'],
      message: 'An assignment cannot be both a substitution and a replacement',
    });
  }
});

export const updateTeacherAllocationSchema = validateDateRange(
  z.object({
    subject: assignmentFields.subject.optional(),
    section: assignmentFields.section.optional(),
    weeklyHours: assignmentFields.weeklyHours.optional(),
    startsAt: assignmentFields.startsAt,
    endsAt: assignmentFields.endsAt,
    isActive: z.boolean().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required'),
);

export const createTimetableSlotSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
}).strict().refine((value) => value.startMinute < value.endMinute, {
  path: ['endMinute'],
  message: 'End time must be after start time',
});

export const availabilitySchema = z.object({
  availability: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  }).strict().refine((value) => value.startMinute < value.endMinute, {
    path: ['endMinute'],
    message: 'End time must be after start time',
  })).max(42),
}).strict().superRefine(({ availability }, context) => {
  for (let i = 0; i < availability.length; i += 1) {
    for (let j = i + 1; j < availability.length; j += 1) {
      const a = availability[i]!;
      const b = availability[j]!;
      if (a.weekday === b.weekday && a.startMinute < b.endMinute && b.startMinute < a.endMinute) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['availability', j],
          message: 'Availability windows on the same day cannot overlap',
        });
      }
    }
  }
});

export const createAllocationRequestSchema = validateDateRange(
  z.object({
    ...assignmentFields,
    type: z.enum(['ASSIGN', 'REPLACE', 'REASSIGN']),
    targetAllocationId: z.string().uuid().optional(),
    note: z.string().trim().max(500).optional(),
  }).strict(),
).superRefine((value, context) => {
  if (value.type !== 'ASSIGN' && !value.targetAllocationId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetAllocationId'],
      message: 'Choose the existing assignment to replace or reassign',
    });
  }
  if (value.type === 'ASSIGN' && value.targetAllocationId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetAllocationId'],
      message: 'An assignment request cannot target an existing assignment',
    });
  }
});

export const decideAllocationRequestSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  decisionNote: z.string().trim().max(500).optional(),
}).strict();

export type CreateTeacherAllocationInput = z.infer<typeof createTeacherAllocationSchema>;
export type UpdateTeacherAllocationInput = z.infer<typeof updateTeacherAllocationSchema>;
export type CreateTimetableSlotInput = z.infer<typeof createTimetableSlotSchema>;
export type AvailabilityInput = z.infer<typeof availabilitySchema>;
export type CreateAllocationRequestInput = z.infer<typeof createAllocationRequestSchema>;
export type DecideAllocationRequestInput = z.infer<typeof decideAllocationRequestSchema>;
