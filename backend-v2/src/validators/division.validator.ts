import { z } from 'zod';
import { emailSchema } from './auth.validator';

export const createDivisionSchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(32).regex(/^[A-Z0-9-]+$/),
  name: z.string().trim().min(2).max(160),
  region: z.string().trim().max(120).optional(),
}).strict();

export const createCoordinatorSchema = z.object({
  schoolId: z.string().uuid(),
  email: emailSchema,
  name: z.string().trim().min(2).max(120),
}).strict();

export const grantCoordinatorDivisionSchema = z.object({
  coordinatorId: z.string().uuid(),
}).strict();

export const setSchoolDivisionSchema = z.object({
  divisionId: z.string().uuid().nullable(),
}).strict();

export const coordinatorDivisionParamsSchema = z.object({
  id: z.string().uuid(),
  coordinatorId: z.string().uuid(),
}).strict();
