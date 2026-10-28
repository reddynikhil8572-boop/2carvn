import { z } from 'zod';

export const publicEnquirySchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(255),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  organisation: z.string().trim().max(160).optional().or(z.literal('')),
  kind: z.enum(['GENERAL', 'DEMO']),
  message: z.string().trim().min(10).max(4000),
  consent: z.literal(true),
}).strict();

export const updateEnquiryStatusSchema = z.object({
  status: z.enum(['NEW', 'IN_PROGRESS', 'CLOSED']),
}).strict();

export type PublicEnquiryInput = z.infer<typeof publicEnquirySchema>;
