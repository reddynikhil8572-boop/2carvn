import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as assignmentApi from '@/api/assignments';
import { courseKeys } from './useCourses';

export const assignmentKeys = {
  detail: (itemId: string) => ['assignment', itemId] as const,
  submission: (id: string) => ['assignment', 'submission', id] as const,
};

export function useAssignment(itemId: string) {
  return useQuery({
    queryKey: assignmentKeys.detail(itemId),
    queryFn: () => assignmentApi.getAssignment(itemId),
  });
}

export function useUpdateAssignment(itemId: string, courseId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: assignmentApi.UpdateAssignmentPayload) =>
      assignmentApi.updateAssignment(itemId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: assignmentKeys.detail(itemId) });
      if (courseId) queryClient.invalidateQueries({ queryKey: courseKeys.detail(courseId) });
    },
  });
}

export function useSubmitAssignment(itemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: assignmentApi.SubmitAssignmentPayload) =>
      assignmentApi.submitAssignment(itemId, payload),
    onSuccess: (submission) => {
      queryClient.setQueryData(assignmentKeys.submission(submission.id), submission);
      queryClient.invalidateQueries({ queryKey: assignmentKeys.detail(itemId) });
    },
  });
}

export function useGradeSubmission(submissionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: assignmentApi.GradeSubmissionPayload) =>
      assignmentApi.gradeSubmission(submissionId, payload),
    onSuccess: (submission) => {
      queryClient.setQueryData(assignmentKeys.submission(submission.id), submission);
      queryClient.invalidateQueries({ queryKey: assignmentKeys.detail(submission.assignmentId) });
    },
  });
}

export function useGetSubmission(submissionId: string) {
  return useQuery({
    queryKey: assignmentKeys.submission(submissionId),
    queryFn: () => assignmentApi.getSubmission(submissionId),
  });
}