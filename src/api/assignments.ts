import { api } from './client';

import type {
  AssignmentView,
  AssignmentSubmission,
  AssignmentWithSubmissions,
} from '@/types/models';
import type { ApiEnvelope } from '@/types/api';

/** Assignments — wraps backend-v2/src/routes/course.routes.ts assignment + submission routes. */

/**
 * Staff receive the full submission list (with student); students receive only
 * their own — the payload is `AssignmentView` plus `submissions`.
 */
export async function getAssignment(itemId: string): Promise<AssignmentWithSubmissions> {
  const res = await api.get<ApiEnvelope<AssignmentWithSubmissions>>(`/items/${itemId}/assignment`);
  return res.data.data;
}

export interface UpdateAssignmentPayload {
  instructions?: string;
  dueAt?: Date | null;
  maxPoints?: number;
  allowsLate?: boolean;
  allowsFile?: boolean;
}

export async function updateAssignment(itemId: string, payload: UpdateAssignmentPayload): Promise<AssignmentView> {
  const res = await api.patch<ApiEnvelope<AssignmentView>>(`/items/${itemId}/assignment`, payload);
  return res.data.data;
}

// ── Submissions ────────────────────────────────────────────────────────────

export interface SubmitAssignmentPayload {
  bodyText?: string;
  fileKey?: string;
}

export async function submitAssignment(itemId: string, payload: SubmitAssignmentPayload): Promise<AssignmentSubmission> {
  const res = await api.post<ApiEnvelope<AssignmentSubmission>>(`/items/${itemId}/submissions`, payload);
  return res.data.data;
}

export async function getSubmission(submissionId: string): Promise<AssignmentSubmission> {
  const res = await api.get<ApiEnvelope<AssignmentSubmission>>(`/submissions/${submissionId}`);
  return res.data.data;
}

export async function getSubmissionFileUrl(submissionId: string): Promise<{ url: string }> {
  const res = await api.get<ApiEnvelope<{ url: string }>>(`/submissions/${submissionId}/file`);
  return res.data.data;
}

export interface GradeSubmissionPayload {
  points?: number;
  feedback?: string;
  /** Only GRADED / RETURNED are accepted — the validator rejects SUBMITTED. */
  status?: 'GRADED' | 'RETURNED';
}

export async function gradeSubmission(submissionId: string, payload: GradeSubmissionPayload): Promise<AssignmentSubmission> {
  const res = await api.post<ApiEnvelope<AssignmentSubmission>>(`/submissions/${submissionId}/grade`, payload);
  return res.data.data;
}

export type { AssignmentWithSubmissions };