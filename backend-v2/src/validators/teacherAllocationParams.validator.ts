import { z } from 'zod';

export const schoolIdQuerySchema = z.object({
  schoolId: z.string().uuid('Invalid school id'),
}).strict();

export const timetableSlotParamsSchema = z.object({
  id: z.string().uuid('Invalid allocation id'),
  slotId: z.string().uuid('Invalid timetable slot id'),
}).strict();

export const teacherIdParamsSchema = z.object({
  teacherId: z.string().uuid('Invalid teacher id'),
}).strict();
