import { api } from './client';
import type { ApiEnvelope } from '@/types/api';

export interface PublicCourse {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  subject: string | null;
  publishedAt: string | null;
}

export interface PublicEnquiryInput {
  name: string;
  email: string;
  phone?: string;
  organisation?: string;
  kind: 'GENERAL' | 'DEMO';
  message: string;
  consent: true;
}

export async function listPublicCourses(): Promise<PublicCourse[]> {
  const response = await api.get<ApiEnvelope<PublicCourse[]>>('/public/courses');
  return response.data.data;
}

export async function submitPublicEnquiry(input: PublicEnquiryInput): Promise<{ id: string }> {
  const response = await api.post<ApiEnvelope<{ id: string; submittedAt: string }>>('/public/enquiries', input);
  return response.data.data;
}
