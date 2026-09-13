import { api } from './client';

import type { ClassSummary, Enrollment } from '@/types/models';
import type { ApiEnvelope } from '@/types/api';

/** Class and enrollment management — wraps backend-v2/src/routes/class.routes.ts. */

export async function listClasses(): Promise<ClassSummary[]> {
  const res = await api.get<ApiEnvelope<ClassSummary[]>>('/classes');
  return res.data.data;
}

export interface CreateClassPayload {
  name: string;
  academicYear: string;
  teacherId?: string;
}

export async function createClass(payload: CreateClassPayload): Promise<ClassSummary> {
  const res = await api.post<ApiEnvelope<ClassSummary>>('/classes', payload);
  return res.data.data;
}

export async function listEnrollments(classId: string): Promise<Enrollment[]> {
  const res = await api.get<ApiEnvelope<Enrollment[]>>(`/classes/${classId}/enrollments`);
  return res.data.data;
}

export async function enrolStudent(classId: string, studentId: string): Promise<Enrollment> {
  const res = await api.post<ApiEnvelope<Enrollment>>(`/classes/${classId}/enrollments`, { studentId });
  return res.data.data;
}
