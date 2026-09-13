import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as quizApi from '@/api/quizzes';
import { courseKeys } from './useCourses';

export const quizKeys = {
  detail: (itemId: string) => ['quiz', itemId] as const,
  attempts: (itemId: string) => ['quiz', itemId, 'attempts'] as const,
  attempt: (id: string) => ['quiz', 'attempt', id] as const,
};

export function useQuiz(itemId: string) {
  return useQuery({
    queryKey: quizKeys.detail(itemId),
    queryFn: () => quizApi.getQuiz(itemId),
  });
}

export function useUpdateQuiz(itemId: string, courseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: quizApi.UpdateQuizPayload) => quizApi.updateQuiz(itemId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: quizKeys.detail(itemId) });
      if (courseId) queryClient.invalidateQueries({ queryKey: courseKeys.detail(courseId) });
    },
  });
}

export function useCreateQuestion(itemId: string, courseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: quizApi.CreateQuestionPayload) => quizApi.createQuestion(itemId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: quizKeys.detail(itemId) });
      if (courseId) queryClient.invalidateQueries({ queryKey: courseKeys.detail(courseId) });
    },
  });
}

// ── Attempts ───────────────────────────────────────────────────────────────

export function useStartAttempt(itemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => quizApi.startAttempt(itemId),
    onSuccess: (attempt) => {
      queryClient.invalidateQueries({ queryKey: quizKeys.attempts(itemId) });
      queryClient.setQueryData(quizKeys.attempt(attempt.id), attempt);
    },
  });
}

export function useAttempts(itemId: string) {
  return useQuery({
    queryKey: quizKeys.attempts(itemId),
    queryFn: () => quizApi.listAttempts(itemId),
  });
}

export function useSubmitAttempt(itemId: string, attemptId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: quizApi.SubmitAttemptPayload) =>
      quizApi.submitAttempt(attemptId, payload),
    onSuccess: (attempt) => {
      queryClient.setQueryData(quizKeys.attempt(attemptId), attempt);
      queryClient.invalidateQueries({ queryKey: quizKeys.attempts(itemId) });
    },
  });
}