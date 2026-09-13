import { api } from './client';

import type { QuizView, QuizQuestionView, QuizAttempt } from '@/types/models';
import type { ApiEnvelope } from '@/types/api';

/**
 * Quiz authoring and attempts — wraps backend-v2/src/routes/course.routes.ts
 * (quiz routes) and the attemptRouter.
 */

// ── Authoring (staff) ──────────────────────────────────────────────────────

export async function getQuiz(itemId: string): Promise<QuizView> {
  const res = await api.get<ApiEnvelope<QuizView>>(`/items/${itemId}/quiz`);
  return res.data.data;
}

export interface UpdateQuizPayload {
  instructions?: string;
  passingScore?: number;
  timeLimitMinutes?: number | null;
  maxAttempts?: number;
  shuffleQuestions?: boolean;
}

export async function updateQuiz(itemId: string, payload: UpdateQuizPayload): Promise<QuizView> {
  const res = await api.patch<ApiEnvelope<QuizView>>(`/items/${itemId}/quiz`, payload);
  return res.data.data;
}

export interface CreateQuestionPayload {
  prompt: string;
  points?: number;
  options: Array<{ text: string; isCorrect: boolean }>;
}

export async function createQuestion(itemId: string, payload: CreateQuestionPayload): Promise<QuizQuestionView> {
  const res = await api.post<ApiEnvelope<QuizQuestionView>>(`/items/${itemId}/questions`, payload);
  return res.data.data;
}

// ── Attempts (student) ─────────────────────────────────────────────────────

export async function startAttempt(itemId: string): Promise<QuizAttempt> {
  const res = await api.post<ApiEnvelope<QuizAttempt>>(`/items/${itemId}/attempts`);
  return res.data.data;
}

export async function listAttempts(itemId: string): Promise<QuizAttempt[]> {
  const res = await api.get<ApiEnvelope<QuizAttempt[]>>(`/items/${itemId}/attempts`);
  return res.data.data;
}

export async function getAttempt(attemptId: string): Promise<QuizAttempt> {
  const res = await api.get<ApiEnvelope<QuizAttempt>>(`/attempts/${attemptId}`);
  return res.data.data;
}

export interface SubmitAttemptPayload {
  answers: Array<{ questionId: string; selectedOptionId: string }>;
  integrityFlags?: Record<string, unknown>;
}

export async function submitAttempt(attemptId: string, payload: SubmitAttemptPayload): Promise<QuizAttempt> {
  const res = await api.post<ApiEnvelope<QuizAttempt>>(`/attempts/${attemptId}/submit`, payload);
  return res.data.data;
}